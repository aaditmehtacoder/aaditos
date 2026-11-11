/**
 * The Notion to-do page: reading its block tree, flattening it into to-dos,
 * and planning what that means for the tasks already in the workspace.
 *
 * Fixtures are shaped like `GET /v1/blocks/{id}/children` results, with
 * `children` filled in the way `fetchBlockTree` leaves them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  courseForPath,
  notionTodoRef,
  planNotionTodoImport,
  type NotionImportInput,
} from "@/lib/core/notion-tasks";
import type { Course, Task } from "@/lib/core/types";
import type { NotionTodoList } from "@/lib/integrations/contracts";
import { serverEnv } from "@/server/env";
import {
  collectNotionTodos,
  fetchBlockTree,
  todoText,
  type NotionBlock,
} from "@/server/providers/notion";

const PAGE = "https://www.notion.so/0123456789abcdef0123456789abcdef";
const EDITED = "2026-11-09T18:00:00.000Z";

let seq = 0;
const rich = (text: string) => ({ rich_text: [{ type: "text", plain_text: text }] });
const heading = (level: 1 | 2 | 3 | 4, text: string): NotionBlock => ({
  id: `h${(seq += 1)}`,
  type: `heading_${level}`,
  [`heading_${level}`]: rich(text),
});
const para = (text: string, children?: NotionBlock[]): NotionBlock => ({
  id: `p${(seq += 1)}`,
  type: "paragraph",
  paragraph: rich(text),
  has_children: Boolean(children),
  ...(children ? { children } : {}),
});
const bullet = (text: string, children: NotionBlock[]): NotionBlock => ({
  id: `b${(seq += 1)}`,
  type: "bulleted_list_item",
  bulleted_list_item: rich(text),
  has_children: true,
  children,
});
const todo = (
  id: string,
  text: string,
  opts: { checked?: boolean; children?: NotionBlock[] } = {},
): NotionBlock => ({
  id,
  type: "to_do",
  to_do: { ...rich(text), checked: opts.checked ?? false },
  has_children: Boolean(opts.children),
  last_edited_time: EDITED,
  ...(opts.children ? { children: opts.children } : {}),
});
const divider = (): NotionBlock => ({ id: `d${(seq += 1)}`, type: "divider", divider: {} });

describe("todoText", () => {
  it("takes a leading typed date out of the title and makes it the due date", () => {
    expect(todoText([{ plain_text: "2026-11-10 Prep presentation" }])).toEqual({
      title: "Prep presentation",
      due: "2026-11-10",
    });
  });

  it("prefers a date mention, and drops the mention's own text", () => {
    expect(
      todoText([
        { type: "text", plain_text: "Lab report " },
        {
          type: "mention",
          plain_text: "November 12, 2026",
          mention: { type: "date", date: { start: "2026-11-12" } },
        },
      ]),
    ).toEqual({ title: "Lab report", due: "2026-11-12" });
  });

  it("leaves a line without a date alone", () => {
    expect(todoText([{ plain_text: "  Practice   squats " }])).toEqual({
      title: "Practice squats",
    });
  });
});

describe("collectNotionTodos", () => {
  const tree: NotionBlock[] = [
    heading(2, "School"),
    heading(4, "Biology"),
    para("Homework / Practice"),
    todo("t1", "Cell worksheet"),
    para("Tests / Quizzes"),
    todo("t2", ""), // placeholder
    todo("t3", "Unit quiz", { checked: true }),
    divider(),
    heading(2, "Clubs"),
    bullet("Robotics", [
      todo("t4", "Weekly meeting", {
        children: [
          todo("t5", "2026-11-12 Order parts"),
          todo("t6", "Book the room", { children: [todo("t7", "Ask the office")] }),
        ],
      }),
    ]),
    divider(),
    para("Tuesday", [todo("t8", "Cell worksheet"), todo("t9", "Call grandma")]),
    { id: "cp", type: "child_page", child_page: { title: "Elsewhere" }, has_children: true },
  ];
  const result = collectNotionTodos(tree, PAGE);
  const byId = new Map(result.todos.map((t) => [t.id, t]));

  it("keeps open to-dos in page order, with where they sit as the path", () => {
    expect(result.todos.map((t) => t.title)).toEqual([
      "Cell worksheet",
      "Weekly meeting",
      "Order parts",
      "Call grandma",
    ]);
    expect(byId.get("t1")?.path).toEqual(["School", "Biology", "Homework / Practice"]);
    expect(byId.get("t9")?.path).toEqual(["Tuesday"]);
  });

  it("links each to-do to its own line", () => {
    expect(byId.get("t1")?.url).toBe(`${PAGE}#t1`);
  });

  it("makes undated nested checkboxes subtasks, flattened, and dated ones tasks", () => {
    expect(byId.get("t4")?.subtasks.map((s) => s.title)).toEqual([
      "Book the room",
      "Ask the office",
    ]);
    expect(byId.get("t5")).toMatchObject({
      due: "2026-11-12",
      path: ["Clubs", "Robotics", "Weekly meeting"],
    });
  });

  it("reports ticked to-dos, skips empty ones, and drops exact repeats", () => {
    expect(result.doneIds).toEqual(["t3"]);
    expect(byId.has("t2")).toBe(false);
    expect(byId.has("t8")).toBe(false); // same text as t1
  });

  it("starts a new section at a divider", () => {
    expect(byId.get("t9")?.path).not.toContain("Clubs");
  });
});

describe("fetchBlockTree", () => {
  it("follows pagination and nesting, and says when it read everything", async () => {
    const pages: Record<string, unknown> = {
      "root?page_size=100": {
        results: [{ id: "a", type: "to_do", has_children: true }],
        has_more: true,
        next_cursor: "c2",
      },
      "root?page_size=100&start_cursor=c2": { results: [{ id: "b", type: "divider" }] },
      "a?page_size=100": { results: [{ id: "a1", type: "to_do" }] },
    };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const key = String(url).replace(/^.*\/blocks\/([^/]+)\/children\?/, "$1?");
      const body = pages[key];
      return body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const tree = await fetchBlockTree("root", "token", fetchImpl);
    expect(tree.complete).toBe(true);
    expect(tree.blocks.map((b) => b.id)).toEqual(["a", "b"]);
    expect(tree.blocks[0]?.children?.map((b) => b.id)).toEqual(["a1"]);
  });

  it("marks the walk incomplete when a branch fails, without failing it", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/blocks/root/")
        ? new Response(
            JSON.stringify({
              results: [{ id: "x", type: "bulleted_list_item", has_children: true }],
            }),
            { status: 200 },
          )
        : new Response("{}", { status: 500 }),
    ) as unknown as typeof fetch;

    const tree = await fetchBlockTree("root", "token", fetchImpl);
    expect(tree.complete).toBe(false);
    expect(tree.blocks).toHaveLength(1);
  });
});

describe("NOTION_TODO_PAGE_ID", () => {
  afterEach(() => {
    delete process.env["NOTION_TODO_PAGE_ID"];
  });

  it("accepts a page URL, query string and all", () => {
    process.env["NOTION_TODO_PAGE_ID"] =
      "https://www.notion.so/To-do-List-3c3af2579ccf80a498b5c591ea891868?pvs=4";
    expect(serverEnv.notionTodoPageId).toBe("3c3af2579ccf80a498b5c591ea891868");
  });

  it("accepts a dashed id", () => {
    process.env["NOTION_TODO_PAGE_ID"] = "3c3af257-9ccf-80a4-98b5-c591ea891868";
    expect(serverEnv.notionTodoPageId).toBe("3c3af2579ccf80a498b5c591ea891868");
  });
});

// ------------------------------------------------------------- planning --

const course = (id: string, name: string): Course => ({
  id,
  userId: "u",
  name,
  color: "var(--chart-1)",
  source: "manual",
  active: true,
  createdAt: EDITED,
  updatedAt: EDITED,
});
const COURSES = [
  course("pe", "PE Core 9"),
  course("eng", "English 9 H"),
  course("fin", "Financial Lit"),
  course("tut", "Tutorial"),
];

describe("courseForPath", () => {
  it("matches a heading to a course written differently", () => {
    expect(courseForPath(["School", "PE", "Homework / Practice"], COURSES)?.id).toBe("pe");
    expect(courseForPath(["English 9 Honors"], COURSES)?.id).toBe("eng");
    expect(courseForPath(["Financial Literacy"], COURSES)?.id).toBe("fin");
  });

  it("does not match on a shared first letter or a lookalike word", () => {
    expect(courseForPath(["Personal"], COURSES)).toBeUndefined();
    expect(courseForPath(["Tutors"], COURSES)).toBeUndefined();
  });
});

describe("planNotionTodoImport", () => {
  const NOW = new Date("2026-11-10T20:00:00.000Z");
  const list: NotionTodoList = {
    todos: [
      {
        id: "t1",
        title: "Practice squats",
        path: ["School", "PE", "Homework / Practice"],
        url: `${PAGE}#t1`,
        subtasks: [],
        editedAt: EDITED,
      },
      {
        id: "t2",
        title: "Get venue",
        path: ["Hackathon"],
        due: "2026-11-12",
        url: `${PAGE}#t2`,
        subtasks: [{ id: "s1", title: "Email judges", done: false }],
        editedAt: EDITED,
      },
    ],
    doneIds: [],
    complete: true,
  };
  const input = (over: Partial<NotionImportInput> = {}): NotionImportInput => ({
    existing: [],
    list,
    courses: COURSES,
    userId: "u",
    now: NOW,
    ...over,
  });
  const imported = planNotionTodoImport(input()).create;
  const task = (ref: string, patch: Partial<Task> = {}): Task => ({
    ...imported.find((t) => t.sourceRef === notionTodoRef(ref))!,
    ...patch,
  });

  it("creates a task per open to-do, with course, context and an all-day due", () => {
    expect(imported).toHaveLength(2);
    expect(task("t1")).toMatchObject({
      title: "Practice squats",
      source: "notion",
      category: "school",
      courseId: "pe",
      description: "PE · Homework / Practice",
      status: "todo",
    });
    // 23:59 in Los Angeles on the 12th.
    expect(task("t2")).toMatchObject({ dueAt: "2026-11-13T07:59:00.000Z", dueAllDay: true });
    expect(task("t2").subtasks.map((s) => s.title)).toEqual(["Email judges"]);
  });

  it("gives the same to-do the same id every time", () => {
    expect(planNotionTodoImport(input()).create.map((t) => t.id)).toEqual(
      imported.map((t) => t.id),
    );
  });

  it("writes nothing when nothing changed", () => {
    expect(planNotionTodoImport(input({ existing: imported }))).toEqual({ create: [], update: [] });
  });

  it("patches only what Notion changed, never what was done here", () => {
    const existing = [task("t1", { priority: "urgent", estimateMin: 90 }), task("t2")];
    const renamed: NotionTodoList = {
      ...list,
      todos: [{ ...list.todos[0]!, title: "Practice 20 squats" }, list.todos[1]!],
    };
    const plan = planNotionTodoImport(input({ existing, list: renamed }));
    expect(plan.update).toEqual([{ id: task("t1").id, patch: { title: "Practice 20 squats" } }]);
  });

  it("keeps a subtask ticked here even while Notion still has it open", () => {
    const t2 = task("t2");
    const existing = [
      task("t1"),
      { ...t2, subtasks: t2.subtasks.map((s) => ({ ...s, done: true })) },
    ];
    expect(planNotionTodoImport(input({ existing })).update).toEqual([]);
  });

  it("leaves a task finished here alone while it is still open in Notion", () => {
    const existing = [task("t1", { status: "done", completedAt: EDITED }), task("t2")];
    expect(planNotionTodoImport(input({ existing })).update).toEqual([]);
  });

  it("finishes a task when it is ticked in Notion", () => {
    const ticked: NotionTodoList = { ...list, todos: [list.todos[1]!], doneIds: ["t1"] };
    const plan = planNotionTodoImport(input({ existing: imported, list: ticked }));
    expect(plan.update).toEqual([
      { id: task("t1").id, patch: { status: "done", completedAt: NOW.toISOString() } },
    ]);
  });

  it("archives a removed to-do, but only after a complete read", () => {
    const gone: NotionTodoList = { ...list, todos: [list.todos[1]!] };
    expect(planNotionTodoImport(input({ existing: imported, list: gone })).update).toEqual([
      { id: task("t1").id, patch: { status: "archived" } },
    ]);
    const partial = { ...gone, complete: false };
    expect(planNotionTodoImport(input({ existing: imported, list: partial })).update).toEqual([]);
  });

  it("reopens an archived task that is back on the page", () => {
    const existing = [task("t1", { status: "archived" }), task("t2")];
    expect(planNotionTodoImport(input({ existing })).update).toEqual([
      { id: task("t1").id, patch: { status: "todo", completedAt: undefined } },
    ]);
  });

  it("keeps a date given here when Notion has none, and lets a Notion date win", () => {
    const later = "2026-11-20T07:59:00.000Z";
    const existing = [task("t1", { dueAt: later, dueAllDay: true }), task("t2", { dueAt: later })];
    expect(planNotionTodoImport(input({ existing })).update).toEqual([
      { id: task("t2").id, patch: { dueAt: "2026-11-13T07:59:00.000Z", dueAllDay: true } },
    ]);
  });

  it("ignores tasks that did not come from the to-do page", () => {
    const manual = { ...task("t1"), id: "m", source: "manual" as const, sourceRef: undefined };
    const plan = planNotionTodoImport(input({ existing: [...imported, manual] }));
    expect(plan).toEqual({ create: [], update: [] });
  });
});

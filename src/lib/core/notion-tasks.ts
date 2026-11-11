/**
 * Notion to-do page → planner tasks.
 *
 * The server reads the page and flattens it (`NotionTodoList`); this decides
 * what that means for the tasks already in the workspace, and returns only
 * the rows that need writing — the list is re-read every few minutes, so an
 * unchanged page must cost nothing.
 *
 * Notion owns a task's wording, its place on the page and its date. The
 * planner owns everything you do to the task here: priority, estimate, a
 * scheduled start, notes, and finishing it. So:
 *
 *   - ticked in Notion            → done here
 *   - finished here, open there   → stays done here (the app never writes to Notion)
 *   - removed from the page       → archived, but only after a complete read
 *   - put back on the page        → open again
 *   - deleted here                → not recreated (the insert skips any ref it has seen)
 */

import type { NotionTodoList } from "@/lib/integrations/contracts";

import { stableId } from "./ids";
import { APP_TZ, zonedToUtc } from "./time";
import type { Course, Subtask, Task, TaskCategory } from "./types";

/** Marks tasks that came from the to-do page, as opposed to anything else Notion. */
export const NOTION_TODO_REF = "notion-todo:";

export function notionTodoRef(blockId: string): string {
  return `${NOTION_TODO_REF}${blockId}`;
}

export function isNotionTodoTask(task: Pick<Task, "source" | "sourceRef">): boolean {
  return task.source === "notion" && Boolean(task.sourceRef?.startsWith(NOTION_TODO_REF));
}

/** YYYY-MM-DD → an all-day due instant, the way typed dates are stored (23:59 local). */
function dueAtFor(day: string): string | undefined {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return zonedToUtc(y, m, d, 23, 59, APP_TZ).toISOString();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * "PE" is "PE Core 9", "English 9 Honors" is "English 9 H", "Financial
 * Literacy" is "Financial Lit": the first word must match exactly, and every
 * word after it may be an abbreviation of the other side's. So "Personal" is
 * not "PE", and "Tutors" is not "Tutorial".
 */
function sameCourse(heading: string, course: string): boolean {
  const a = words(heading);
  const b = words(course);
  if (a.length === 0 || b.length === 0 || a[0] !== b[0] || a[0]!.length < 2) return false;
  const n = Math.min(a.length, b.length);
  for (let i = 1; i < n; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (!x.startsWith(y) && !y.startsWith(x)) return false;
  }
  return true;
}

/** The course a to-do sits under, looking from the nearest heading outwards. */
export function courseForPath(path: string[], courses: Course[]): Course | undefined {
  const active = courses.filter((c) => c.active);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const match = active.find((c) => sameCourse(path[i]!, c.name));
    if (match) return match;
  }
  return undefined;
}

function categoryFor(path: string[]): TaskCategory {
  const text = path.join(" ").toLowerCase();
  if (/\b(school|class|classes|homework|quiz|quizzes|tests?|exams?|clubs?)\b/.test(text)) {
    return "school";
  }
  if (/\b(work|job|startup|business)\b/.test(text)) return "work";
  return "personal";
}

/** The two innermost places on the page: "PE · Homework / Practice", "Beacon Hacks". */
function describe(path: string[]): string | undefined {
  const tail = path.slice(-2);
  return tail.length > 0 ? tail.join(" · ") : undefined;
}

function sameSubtasks(a: Subtask[], b: Subtask[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.id === b[i]!.id && s.title === b[i]!.title && s.done === b[i]!.done)
  );
}

export interface NotionImportInput {
  existing: Task[];
  list: NotionTodoList;
  courses: Course[];
  userId: string;
  now: Date;
}

export interface NotionImportPlan {
  /** New to-dos. Inserted only where no row has that ref yet, deleted or not. */
  create: Task[];
  /**
   * Changes to tasks already here, as patches of the fields Notion owns, so
   * a stale copy in memory cannot overwrite what was done to the task since.
   */
  update: Array<{ id: string; patch: Partial<Task> }>;
}

/** Pure: what to write so the workspace matches the page. Empty when nothing changed. */
export function planNotionTodoImport(input: NotionImportInput): NotionImportPlan {
  const { existing, list, courses, userId, now } = input;
  const stamp = now.toISOString();
  const known = new Map<string, Task>();
  for (const task of existing) {
    if (isNotionTodoTask(task) && !task.deletedAt) known.set(task.sourceRef!, task);
  }

  const plan: NotionImportPlan = { create: [], update: [] };
  const open = new Set<string>();

  list.todos.forEach((todo, index) => {
    const ref = notionTodoRef(todo.id);
    open.add(ref);
    const before = known.get(ref);
    const course = courseForPath(todo.path, courses);
    const dueAt = todo.due ? dueAtFor(todo.due) : undefined;
    const description = describe(todo.path);
    const subtasks: Subtask[] = todo.subtasks.map((s, position) => {
      const id = stableId(`${ref}:${s.id}`);
      const prior = before?.subtasks.find((p) => p.id === id || p.title === s.title);
      return { id, title: s.title, done: s.done || Boolean(prior?.done), position };
    });

    if (!before) {
      plan.create.push({
        id: stableId(`${userId}:${ref}`),
        userId,
        title: todo.title,
        description,
        category: course ? "school" : categoryFor(todo.path),
        courseId: course?.id,
        dueAt,
        dueAllDay: Boolean(dueAt),
        priority: "normal",
        status: "todo",
        estimateMin: 30,
        source: "notion",
        sourceRef: ref,
        externalUrl: todo.url,
        subtasks,
        attachments: [],
        position: index,
        createdAt: stamp,
        updatedAt: stamp,
      });
      return;
    }

    const patch: Partial<Task> = {};
    if (before.title !== todo.title) patch.title = todo.title;
    if (description && before.description !== description) patch.description = description;
    if (before.externalUrl !== todo.url) patch.externalUrl = todo.url;
    if (!before.courseId && course) patch.courseId = course.id;
    if (!sameSubtasks(before.subtasks, subtasks)) patch.subtasks = subtasks;
    // A date in Notion wins; without one, any date given here stays.
    if (dueAt && (before.dueAt !== dueAt || !before.dueAllDay)) {
      patch.dueAt = dueAt;
      patch.dueAllDay = true;
    }
    // Archived because it left the page, and now it is back.
    if (before.status === "archived") {
      patch.status = "todo";
      patch.completedAt = undefined;
    }
    if (Object.keys(patch).length > 0) plan.update.push({ id: before.id, patch });
  });

  const ticked = new Set(list.doneIds.map(notionTodoRef));
  for (const [ref, task] of known) {
    if (open.has(ref)) continue;
    if (task.status !== "todo" && task.status !== "in_progress") continue;
    if (ticked.has(ref)) {
      plan.update.push({ id: task.id, patch: { status: "done", completedAt: stamp } });
    } else if (list.complete) {
      plan.update.push({ id: task.id, patch: { status: "archived" } });
    }
  }
  return plan;
}

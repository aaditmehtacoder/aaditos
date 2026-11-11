/**
 * Notion adapter — what changed lately, and open tasks if you keep them there.
 *
 * An internal integration secret, with the pages you want visible shared to
 * the integration inside Notion. Two read-only calls:
 *
 *   - `search`, sorted by last edit, for pages touched in the last week. These
 *     become Inbox items so a doc a teammate edited surfaces here.
 *   - optionally, a database query (`NOTION_TASKS_DATABASE_ID`) for rows whose
 *     checkbox is unchecked / status is not Done — those are yours to file.
 *
 * And optionally a to-do *page* (`NOTION_TODO_PAGE_ID`): an ordinary page of
 * checkboxes under headings and bullets. Its block tree is walked and every
 * open checkbox comes back as a `NotionTodo`, which the client turns into a
 * planner task. That page is left out of the Inbox's "recently edited" list,
 * since its contents are already on Today.
 */

import type { InboxItem, NotionTodo, NotionTodoList } from "@/lib/integrations/contracts";

import { serverEnv } from "../env";

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

export function notionConfigured(): boolean {
  return Boolean(serverEnv.notionToken);
}

interface RichText {
  plain_text?: string;
}

interface NotionPage {
  id?: string;
  object?: string;
  url?: string;
  last_edited_time?: string;
  archived?: boolean;
  parent?: { type?: string; database_id?: string; page_id?: string; workspace?: boolean };
  properties?: Record<string, NotionProperty>;
  title?: RichText[];
}

interface NotionProperty {
  type?: string;
  title?: RichText[];
  rich_text?: RichText[];
  checkbox?: boolean;
  status?: { name?: string };
  select?: { name?: string };
  date?: { start?: string | null } | null;
}

export function pageTitle(page: NotionPage): string {
  if (Array.isArray(page.title)) return page.title.map((t) => t.plain_text ?? "").join("");
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop.type === "title" && Array.isArray(prop.title)) {
      return prop.title.map((t) => t.plain_text ?? "").join("");
    }
  }
  return "";
}

/** Pure: search results → inbox items (pages edited within `days`). Exported for tests. */
export function normalizeNotionPages(rows: unknown, now: Date, days = 7): InboxItem[] {
  if (!Array.isArray(rows)) return [];
  const cutoff = now.getTime() - days * 86_400_000;
  const out: InboxItem[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const page = entry as NotionPage;
    if (page.archived || !page.id) continue;
    const title = pageTitle(page).trim();
    if (!title) continue;
    const edited = page.last_edited_time ? new Date(page.last_edited_time) : null;
    if (!edited || Number.isNaN(edited.getTime()) || edited.getTime() < cutoff) continue;
    out.push({
      id: `notion:${page.id}`,
      source: "notion",
      title,
      detail: page.object === "database" ? "Database" : "Page edited",
      url: page.url,
      at: edited.toISOString(),
    });
  }
  return out;
}

/** Pure: database rows → open task-like inbox items. Exported for tests. */
export function normalizeNotionTasks(rows: unknown): InboxItem[] {
  if (!Array.isArray(rows)) return [];
  const out: InboxItem[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const page = entry as NotionPage;
    if (page.archived || !page.id) continue;
    const title = pageTitle(page).trim();
    if (!title) continue;
    const props = Object.values(page.properties ?? {});
    const done = props.some(
      (p) =>
        (p.type === "checkbox" && p.checkbox === true) ||
        (p.type === "status" && /done|complete/i.test(p.status?.name ?? "")) ||
        (p.type === "select" && /done|complete/i.test(p.select?.name ?? "")),
    );
    if (done) continue;
    const due = props.find((p) => p.type === "date" && p.date?.start)?.date?.start ?? null;
    out.push({
      id: `notion:task:${page.id}`,
      source: "notion",
      title,
      detail: due ? `Due ${due}` : "Open in Notion tasks",
      url: page.url,
      at: page.last_edited_time ?? new Date().toISOString(),
    });
  }
  return out;
}

// ------------------------------------------------------------ to-do page --

interface NotionRichText {
  type?: string;
  plain_text?: string;
  mention?: { type?: string; date?: { start?: string | null } | null };
}

/** A block as the API returns it, plus `children` once the walk fills them in. */
export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  archived?: boolean;
  in_trash?: boolean;
  last_edited_time?: string;
  children?: NotionBlock[];
  [key: string]: unknown;
}

/** Containers whose contents belong to another page, never to this list. */
const FOREIGN = new Set(["child_page", "child_database", "link_to_page", "unsupported"]);
/** A paragraph this short, with nothing under it, labels the lines below it. */
const LABEL_MAX = 48;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function richText(block: NotionBlock): NotionRichText[] {
  const body = block[block.type];
  if (!body || typeof body !== "object") return [];
  const rich = (body as { rich_text?: unknown }).rich_text;
  return Array.isArray(rich) ? (rich as NotionRichText[]) : [];
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A to-do's text and the date it carries, if any. A date mention wins over a
 * typed date; whichever is used is taken out of the title so "2026-11-10 Prep
 * Presentation" reads as "Prep Presentation", due the 10th.
 */
export function todoText(rich: NotionRichText[]): { title: string; due?: string } {
  let due: string | undefined;
  let text = "";
  for (const part of rich) {
    const start = part.type === "mention" ? part.mention?.date?.start : null;
    if (start && !due && ISO_DATE.test(start)) {
      due = start.slice(0, 10);
      continue;
    }
    text += part.plain_text ?? "";
  }
  if (!due) {
    const typed = text.match(ISO_DATE);
    if (typed) {
      due = typed[0];
      text = text.replace(typed[0], " ");
    }
  }
  const title = tidy(text).replace(/^[-–—:·,\s]+|[-–—:·,\s]+$/g, "");
  return due ? { title, due } : { title };
}

interface Draft extends NotionTodo {
  /** Lower-cased title, for removing exact repeats. */
  key: string;
}

/**
 * Pure: a walked block tree → the open to-dos on it. Exported for tests.
 *
 * Headings, short labels and the bullets a line is nested under become its
 * `path`. A checkbox nested inside another checkbox is a subtask of the
 * outermost one — unless it has a date of its own, in which case it is a task
 * in its own right ("Meet every Tuesday" → "2026-11-10 Prep Presentation").
 * Empty checkboxes (placeholders under "Tests / Quizzes") are skipped. A
 * divider ends the current section, the way it reads on the page.
 */
export function collectNotionTodos(
  blocks: NotionBlock[],
  pageUrl: string,
): Omit<NotionTodoList, "complete"> {
  const drafts: Draft[] = [];
  const doneIds: string[] = [];
  const base = pageUrl.split("#")[0] ?? pageUrl;
  const urlFor = (id: string) => `${base}#${id.replace(/-/g, "")}`;

  const visit = (list: NotionBlock[], inherited: string[], owner: Draft | null): void => {
    // Heading levels 1–4 in force for the lines that follow, and the label.
    let headings: Array<string | undefined> = [];
    let label: string | undefined;
    const pathHere = () =>
      [...inherited, ...headings, label].filter((s): s is string => Boolean(s));

    for (const block of list) {
      if (block.archived || block.in_trash || FOREIGN.has(block.type)) continue;
      const children = block.children ?? [];
      const text = tidy(
        richText(block)
          .map((r) => r.plain_text ?? "")
          .join(""),
      );

      if (block.type === "divider") {
        headings = [];
        label = undefined;
        continue;
      }
      const level = /^heading_([1-4])$/.exec(block.type)?.[1];
      if (level) {
        const index = Number(level) - 1;
        headings = headings.slice(0, index);
        headings[index] = text || undefined;
        label = undefined;
        if (children.length > 0) visit(children, pathHere(), owner); // toggle heading
        continue;
      }

      if (block.type === "to_do") {
        const { title, due } = todoText(richText(block));
        const checked = (block["to_do"] as { checked?: boolean } | undefined)?.checked === true;
        if (!title) {
          // A placeholder; anything under it still counts, in the same place.
          if (children.length > 0) visit(children, pathHere(), owner);
          continue;
        }
        if (owner && !due) {
          owner.subtasks.push({ id: block.id, title, done: checked });
          if (children.length > 0) visit(children, [...pathHere(), title], owner);
          continue;
        }
        if (checked) doneIds.push(block.id);
        const draft: Draft = {
          id: block.id,
          title,
          path: pathHere(),
          ...(due ? { due } : {}),
          url: urlFor(block.id),
          subtasks: [],
          editedAt: block.last_edited_time ?? new Date(0).toISOString(),
          key: title.toLowerCase(),
        };
        if (!checked) drafts.push(draft);
        if (children.length > 0) visit(children, [...pathHere(), title], draft);
        continue;
      }

      if (block.type === "paragraph" && children.length === 0) {
        if (text && text.length <= LABEL_MAX) label = text;
        continue;
      }

      // Bullets, numbered items, toggles, callouts, quotes, columns, synced
      // blocks: their text (if any) is context for what is inside them.
      if (children.length > 0) visit(children, text ? [...pathHere(), text] : pathHere(), owner);
    }
  };

  visit(blocks, [], null);

  const seen = new Set<string>();
  const todos: NotionTodo[] = [];
  for (const { key, ...todo } of drafts) {
    if (seen.has(key)) continue;
    seen.add(key);
    todos.push(todo);
  }
  return { todos, doneIds };
}

/** Bounds on one walk, so a huge page cannot stall a sync. */
const WALK_MAX_REQUESTS = 120;
const WALK_MAX_DEPTH = 8;
/** Notion allows about three requests a second per integration. */
const WALK_CONCURRENCY = 3;

/**
 * Read a page's whole block tree. Children are fetched three at a time; a
 * 429 waits out `Retry-After` once. Anything left unread — budget, depth or a
 * failed branch — makes `complete` false rather than failing the whole walk.
 */
export async function fetchBlockTree(
  rootId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blocks: NotionBlock[]; complete: boolean }> {
  let requests = 0;
  let complete = true;
  let active = 0;
  const waiting: Array<() => void> = [];
  const slot = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= WALK_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };

  const page = async (
    id: string,
    cursor?: string,
  ): Promise<{ results: NotionBlock[]; next?: string }> => {
    const query = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = await slot(() =>
      get<{ results?: NotionBlock[]; has_more?: boolean; next_cursor?: string | null }>(
        `/blocks/${id}/children?${query}`,
        token,
        fetchImpl,
      ),
    );
    return {
      results: Array.isArray(body.results) ? body.results : [],
      ...(body.has_more && body.next_cursor ? { next: body.next_cursor } : {}),
    };
  };

  const children = async (id: string, depth: number): Promise<NotionBlock[]> => {
    const out: NotionBlock[] = [];
    let cursor: string | undefined;
    do {
      if (requests >= WALK_MAX_REQUESTS) {
        complete = false;
        break;
      }
      requests += 1;
      const batch = await page(id, cursor);
      out.push(...batch.results);
      cursor = batch.next;
    } while (cursor);

    const nested = out.filter((b) => b.has_children && !FOREIGN.has(b.type));
    if (nested.length > 0 && depth >= WALK_MAX_DEPTH) {
      complete = false;
      return out;
    }
    await Promise.all(
      nested.map(async (block) => {
        try {
          block.children = await children(block.id, depth + 1);
        } catch {
          complete = false;
        }
      }),
    );
    return out;
  };

  const blocks = await children(rootId, 1);
  return { blocks, complete };
}

async function readTodoPage(
  pageId: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<NotionTodoList> {
  const tree = await fetchBlockTree(pageId, token, fetchImpl);
  const url = `https://www.notion.so/${pageId}`;
  return { ...collectNotionTodos(tree.blocks, url), complete: tree.complete };
}

function notionError(status: number, what: "database" | "page"): Error {
  if (status === 401) return new Error("Notion rejected the token. Check NOTION_TOKEN.");
  if (status === 404) {
    return new Error(`Notion could not find that ${what}. Share it with the integration.`);
  }
  return new Error(`Notion returned ${status}`);
}

async function get<T>(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
  what: "database" | "page" = "page",
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(`${API}${path}`, {
      headers: { authorization: `Bearer ${token}`, "notion-version": VERSION },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 429 && attempt === 0) {
      const wait = Math.min(Number(response.headers.get("retry-after")) || 1, 3);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!response.ok) throw notionError(response.status, what);
    return (await response.json()) as T;
  }
}

async function post<T>(
  path: string,
  body: unknown,
  token: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw notionError(response.status, "database");
  return (await response.json()) as T;
}

export interface NotionResult {
  configured: boolean;
  ok: boolean;
  items: InboxItem[];
  /** Present when `NOTION_TODO_PAGE_ID` is set and the page could be read. */
  todos?: NotionTodoList;
  error?: string;
}

export async function fetchNotion(fetchImpl: typeof fetch = fetch): Promise<NotionResult> {
  const token = serverEnv.notionToken;
  if (!token) {
    return { configured: false, ok: false, items: [], error: "NOTION_TOKEN is not set." };
  }
  const now = new Date();
  const databaseId = serverEnv.notionTasksDatabaseId;
  const todoPageId = serverEnv.notionTodoPageId;

  const [recent, tasks, todoPage] = await Promise.allSettled([
    post<{ results?: unknown }>(
      "/search",
      { sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 25 },
      token,
      fetchImpl,
    ).then((r) => normalizeNotionPages(r.results, now)),
    databaseId
      ? post<{ results?: unknown }>(
          `/databases/${databaseId}/query`,
          { page_size: 50 },
          token,
          fetchImpl,
        ).then((r) => normalizeNotionTasks(r.results))
      : Promise.resolve([] as InboxItem[]),
    todoPageId ? readTodoPage(todoPageId, token, fetchImpl) : Promise.resolve(undefined),
  ]);

  const items = new Map<string, InboxItem>();
  const problems: string[] = [];
  for (const result of [tasks, recent]) {
    if (result.status === "fulfilled") {
      for (const item of result.value) if (!items.has(item.id)) items.set(item.id, item);
    } else {
      problems.push(result.reason instanceof Error ? result.reason.message : "request failed");
    }
  }
  if (todoPage.status === "rejected") {
    const reason = todoPage.reason instanceof Error ? todoPage.reason.message : "request failed";
    problems.push(`To-do page: ${reason}`);
  }
  // The to-do page's lines are tasks now; "you edited your to-do list" is noise.
  if (todoPageId) items.delete(`notion:${dashed(todoPageId)}`);

  return {
    configured: true,
    ok: recent.status === "fulfilled",
    items: [...items.values()].sort((a, b) => b.at.localeCompare(a.at)),
    ...(todoPage.status === "fulfilled" && todoPage.value ? { todos: todoPage.value } : {}),
    ...(problems.length > 0 ? { error: problems.join(" · ") } : {}),
  };
}

/** 32 hex characters → the 8-4-4-4-12 form the API uses in `id`. */
function dashed(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

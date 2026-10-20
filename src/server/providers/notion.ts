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
 */

import type { InboxItem } from "@/lib/integrations/contracts";

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
  if (response.status === 401) throw new Error("Notion rejected the token. Check NOTION_TOKEN.");
  if (response.status === 404) {
    throw new Error("Notion could not find that database. Share it with the integration.");
  }
  if (!response.ok) throw new Error(`Notion returned ${response.status}`);
  return (await response.json()) as T;
}

export interface NotionResult {
  configured: boolean;
  ok: boolean;
  items: InboxItem[];
  error?: string;
}

export async function fetchNotion(fetchImpl: typeof fetch = fetch): Promise<NotionResult> {
  const token = serverEnv.notionToken;
  if (!token) {
    return { configured: false, ok: false, items: [], error: "NOTION_TOKEN is not set." };
  }
  const now = new Date();
  const databaseId = serverEnv.notionTasksDatabaseId;

  const [recent, tasks] = await Promise.allSettled([
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

  return {
    configured: true,
    ok: recent.status === "fulfilled",
    items: [...items.values()].sort((a, b) => b.at.localeCompare(a.at)),
    ...(problems.length > 0 ? { error: problems.join(" · ") } : {}),
  };
}

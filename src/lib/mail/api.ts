/**
 * The browser's side of the mail client: types that mirror the server's,
 * fetchers that carry the sign-in token, and the small formatting rules a
 * mail list lives by.
 */

import { withBase } from "@/lib/base-path";
import { authHeaders } from "@/lib/compass/client";

export type FolderId =
  "inbox" | "starred" | "important" | "sent" | "drafts" | "all" | "spam" | "trash";

export type Category = "primary" | "promotions" | "social" | "updates" | "forums";

export type MailAction =
  | "archive"
  | "inbox"
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "important"
  | "notImportant"
  | "trash"
  | "untrash"
  | "spam"
  | "notSpam";

export interface MailSummary {
  id: string;
  threadId: string;
  account: string;
  from: string;
  fromAddress: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
  inInbox: boolean;
  draft: boolean;
}

/** A row in the list: the newest message of a conversation, standing for all of it. */
export interface MailThreadRow extends MailSummary {
  count: number;
}

export interface ThreadMessage {
  id: string;
  from: string;
  fromName: string;
  fromAddress: string;
  to: string;
  cc: string;
  date: string;
  text: string;
  /** Sanitized HTML, shown in a sandboxed frame; empty for plain-text mail. */
  html: string;
  snippet: string;
  unread: boolean;
  starred: boolean;
  attachments: Array<{
    filename: string;
    size: number;
    mimeType: string;
    attachmentId?: string;
    partId?: string;
  }>;
}

export interface ThreadView {
  id: string;
  account: string;
  subject: string;
  labelIds: string[];
  messages: ThreadMessage[];
}

export interface MailCounts {
  inbox: number;
  drafts: number;
  spam: number;
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function mailFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBase(path), {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    message?: string;
    code?: string;
  };
  if (!response.ok || data.ok === false) {
    throw new MailError(data.message ?? `Request failed (${response.status})`, data.code);
  }
  return data;
}

export function listPage(
  account: string,
  opts: {
    folder: FolderId;
    category?: Category | undefined;
    q?: string | undefined;
    pageToken?: string | undefined;
  },
) {
  const params = new URLSearchParams({ account, folder: opts.folder });
  if (opts.category) params.set("category", opts.category);
  if (opts.q) params.set("q", opts.q);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  return mailFetch<{ items: MailSummary[]; nextPageToken?: string; estimate: number }>(
    `api/gmail/list?${params}`,
  );
}

export function fetchCounts(account: string) {
  return mailFetch<{ counts: MailCounts }>(`api/gmail/counts?${new URLSearchParams({ account })}`);
}

export function fetchThread(account: string, threadId: string) {
  return mailFetch<{ thread: ThreadView }>(
    `api/gmail/thread?${new URLSearchParams({ account, id: threadId })}`,
  );
}

export function modify(account: string, threadIds: string[], action: MailAction) {
  return mailFetch<{ count: number }>("api/gmail/modify", {
    method: "POST",
    body: JSON.stringify({ account, threadIds, action }),
  });
}

export function sendReply(account: string, id: string, text: string, all: boolean) {
  return mailFetch<{ to: string; cc: string }>("api/gmail/reply", {
    method: "POST",
    body: JSON.stringify({ account, id, text, all }),
  });
}

export function sendNew(
  account: string,
  mail: { to: string; cc: string; bcc: string; subject: string; text: string },
) {
  return mailFetch<{ to: string[] }>("api/gmail/send", {
    method: "POST",
    body: JSON.stringify({ account, ...mail }),
  });
}

export function draft(
  account: string,
  opts: {
    id?: string | undefined;
    instruction?: string | undefined;
    current?: string | undefined;
    to?: string | undefined;
    subject?: string | undefined;
  },
) {
  return mailFetch<{ text: string; subject?: string }>("api/gmail/draft", {
    method: "POST",
    body: JSON.stringify({ account, ...opts }),
  });
}

/** One row per conversation, newest first: the newest message stands for the rest. */
export function groupThreads(items: MailSummary[]): MailThreadRow[] {
  const byThread = new Map<string, MailThreadRow>();
  for (const item of items) {
    const key = `${item.account}|${item.threadId}`;
    const seen = byThread.get(key);
    if (!seen) {
      byThread.set(key, { ...item, count: 1 });
      continue;
    }
    const newer = item.date > seen.date ? item : seen;
    byThread.set(key, {
      ...newer,
      count: seen.count + 1,
      unread: seen.unread || item.unread,
      starred: seen.starred || item.starred,
      important: seen.important || item.important,
    });
  }
  return [...byThread.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Gmail's own rule: a time today, a date this year, a short date before that. */
export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const AVATAR_COLORS = [
  "oklch(0.62 0.17 25)",
  "oklch(0.62 0.15 145)",
  "oklch(0.58 0.17 255)",
  "oklch(0.66 0.15 70)",
  "oklch(0.58 0.17 300)",
  "oklch(0.6 0.12 195)",
  "oklch(0.6 0.16 350)",
];

/** A stable colour per sender, so the same person always looks the same. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (const ch of seed.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

/**
 * Splits off the quoted history most replies carry ("On … wrote:" and the
 * ">" lines under it), so the conversation shows what is new and folds the
 * rest away, the way mail clients do.
 */
export function splitQuoted(text: string): { fresh: string; quoted: string } {
  const lines = text.split("\n");
  const at = lines.findIndex(
    (line, i) =>
      /^On .{6,200}wrote:\s*$/.test(line.trim()) ||
      // Hard-wrapped mail splits the header over two lines.
      (/^On\s/.test(line.trim()) && /wrote:\s*$/.test(`${line} ${lines[i + 1] ?? ""}`.trim())) ||
      /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(line.trim()) ||
      /^-{2,}\s*on\s.+wrote\s*-{2,}$/i.test(line.trim()) ||
      (line.startsWith(">") && lines.slice(i).every((l) => l.startsWith(">") || !l.trim())),
  );
  if (at <= 0) return { fresh: text, quoted: "" };
  return { fresh: lines.slice(0, at).join("\n").trimEnd(), quoted: lines.slice(at).join("\n") };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

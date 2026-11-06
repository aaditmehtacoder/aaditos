/**
 * A mailbox the way a mail client sees it: folders, conversations, and the
 * everyday actions on them.
 *
 * Reading needs gmail.readonly; sending needs gmail.send; archiving,
 * starring, read state and Trash need gmail.modify. Trash is Gmail's own,
 * emptied by Gmail after 30 days and undoable until then; nothing here can
 * delete a message outright, and gmail.modify cannot either.
 */

import { accessTokenFromRefresh } from "./google";
import {
  addressOf,
  allHeaders,
  api,
  buildMessage,
  messageHtml,
  messageText,
  postMessage,
  senderName,
  splitAddresses,
  type FullMessage,
  type GmailPart,
} from "./gmail";

export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export const FOLDERS = {
  inbox: { labelIds: ["INBOX"], spamTrash: false },
  starred: { labelIds: ["STARRED"], spamTrash: false },
  important: { labelIds: ["IMPORTANT"], spamTrash: false },
  sent: { labelIds: ["SENT"], spamTrash: false },
  drafts: { labelIds: ["DRAFT"], spamTrash: false },
  all: { labelIds: [] as string[], spamTrash: false },
  spam: { labelIds: ["SPAM"], spamTrash: true },
  trash: { labelIds: ["TRASH"], spamTrash: true },
} as const;
export type FolderId = keyof typeof FOLDERS;

export const CATEGORIES = ["primary", "promotions", "social", "updates", "forums"] as const;
export type Category = (typeof CATEGORIES)[number];

export function isFolder(value: unknown): value is FolderId {
  return typeof value === "string" && value in FOLDERS;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

interface Account {
  refreshToken: string;
  email?: string | undefined;
}

export interface MailSummary {
  id: string;
  threadId: string;
  account: string;
  from: string;
  fromAddress: string;
  to: string;
  subject: string;
  snippet: string;
  /** ISO instant. */
  date: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
  inInbox: boolean;
  draft: boolean;
}

/** Runs `fn` over `items` at most `limit` at a time, in order. Gmail meters requests per second. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Characters some senders pad previews with. An alternation: a few are combining marks. */
const INVISIBLE =
  /\u00AD|\u034F|\u061C|\u115F|\u1160|\u17B4|\u17B5|\u180E|\u200B|\u200C|\u200D|\u200E|\u200F|\u2060|\u2061|\u2062|\u2063|\u2064|\uFEFF/g;

/**
 * Entities decoded, and the invisible padding some senders put in previews
 * (combining grapheme joiners, zero-width spaces, soft hyphens) removed.
 */
const decodeEntities = (text: string) =>
  text
    .replace(INVISIBLE, "")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

function summaryOf(message: FullMessage, account: string): MailSummary | null {
  if (!message.id) return null;
  const h = allHeaders(message);
  const labels = message.labelIds ?? [];
  const millis = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId ?? message.id,
    account,
    from: senderName(h("From")) || addressOf(h("From")) || "(unknown)",
    fromAddress: addressOf(h("From")),
    to: h("To"),
    subject: h("Subject").trim() || "(no subject)",
    snippet: decodeEntities(message.snippet ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    date:
      Number.isFinite(millis) && millis > 0
        ? new Date(millis).toISOString()
        : new Date().toISOString(),
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    important: labels.includes("IMPORTANT"),
    inInbox: labels.includes("INBOX"),
    draft: labels.includes("DRAFT"),
  };
}

/**
 * One page of a folder, newest first. A search looks through all mail, the
 * way Gmail's search box does, unless the query names a folder itself.
 */
export async function listMail(
  account: Account,
  opts: {
    folder: FolderId;
    category?: Category | undefined;
    q?: string | undefined;
    pageToken?: string | undefined;
    max?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ items: MailSummary[]; nextPageToken?: string | undefined; estimate: number }> {
  const token = await accessTokenFromRefresh(account.refreshToken);
  const params = new URLSearchParams({ maxResults: String(Math.min(opts.max ?? 30, 50)) });
  const q = opts.q?.trim();
  if (q) {
    params.set("q", q.slice(0, 500));
  } else {
    const folder = FOLDERS[opts.folder];
    for (const id of folder.labelIds) params.append("labelIds", id);
    if (folder.spamTrash) params.set("includeSpamTrash", "true");
    if (opts.folder === "inbox" && opts.category) params.set("q", `category:${opts.category}`);
  }
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const list = await api<{
    messages?: Array<{ id?: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(`/messages?${params}`, token, fetchImpl);
  const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  const messages = await pool(ids, 8, (id) =>
    api<FullMessage>(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      token,
      fetchImpl,
    ).catch(() => null),
  );
  const email = account.email ?? "";
  return {
    items: messages
      .map((m) => (m ? summaryOf(m, email) : null))
      .filter((m): m is MailSummary => m !== null),
    nextPageToken: list.nextPageToken,
    estimate: list.resultSizeEstimate ?? ids.length,
  };
}

/** The numbers next to the folders. */
export async function mailCounts(
  account: Account,
  fetchImpl: typeof fetch = fetch,
): Promise<{ inbox: number; drafts: number; spam: number }> {
  const token = await accessTokenFromRefresh(account.refreshToken);
  const label = (id: string) =>
    api<{ threadsUnread?: number; messagesTotal?: number }>(
      `/labels/${id}`,
      token,
      fetchImpl,
    ).catch(() => ({}) as { threadsUnread?: number; messagesTotal?: number });
  const [inbox, drafts, spam] = await Promise.all([label("INBOX"), label("DRAFT"), label("SPAM")]);
  return {
    inbox: inbox.threadsUnread ?? 0,
    drafts: drafts.messagesTotal ?? 0,
    spam: spam.threadsUnread ?? 0,
  };
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
  /** The formatted version, sanitized; shown in a sandboxed frame. Empty for plain-text mail. */
  html: string;
  snippet: string;
  unread: boolean;
  starred: boolean;
  attachments: AttachmentRef[];
}

export interface ThreadView {
  id: string;
  account: string;
  subject: string;
  labelIds: string[];
  messages: ThreadMessage[];
}

export interface AttachmentRef {
  filename: string;
  size: number;
  mimeType: string;
  /** Gmail's handle for the bytes; absent for small parts carried inline. */
  attachmentId?: string | undefined;
  /** Where the part sits in the message, for the inline ones. */
  partId?: string | undefined;
}

function attachmentsOf(part: GmailPart | undefined): AttachmentRef[] {
  if (!part) return [];
  const own: AttachmentRef[] = part.filename
    ? [
        {
          filename: part.filename,
          size: part.body?.size ?? 0,
          mimeType: part.mimeType ?? "application/octet-stream",
          attachmentId: part.body?.attachmentId,
          partId: part.partId,
        },
      ]
    : [];
  return [...own, ...(part.parts ?? []).flatMap((p) => attachmentsOf(p))];
}

/** The most an attachment can be and still pass through the host's response limit. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** One attachment's bytes, by Gmail's handle or, for an inline part, by its place in the message. */
export async function fetchAttachment(
  account: Account,
  messageId: string,
  ref: { attachmentId?: string | undefined; partId?: string | undefined },
  fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const token = await accessTokenFromRefresh(account.refreshToken);
  let data: string | undefined;
  if (ref.attachmentId) {
    const body = await api<{ data?: string; size?: number }>(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(ref.attachmentId)}`,
      token,
      fetchImpl,
    );
    data = body.data;
  } else if (ref.partId) {
    const message = await api<FullMessage>(
      `/messages/${encodeURIComponent(messageId)}?format=full`,
      token,
      fetchImpl,
    );
    const find = (p: GmailPart | undefined): GmailPart | undefined =>
      !p ? undefined : p.partId === ref.partId ? p : (p.parts ?? []).map(find).find(Boolean);
    data = find(message.payload)?.body?.data;
  }
  if (!data) throw new Error("That attachment is not there any more.");
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

/**
 * A whole conversation, every message as plain text. With `markRead` (and
 * gmail.modify) opening it marks it read, as opening it in Gmail would.
 */
export async function getThread(
  account: Account,
  threadId: string,
  opts: { markRead?: boolean } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ThreadView> {
  const token = await accessTokenFromRefresh(account.refreshToken);
  const thread = await api<{ id?: string; messages?: FullMessage[] }>(
    `/threads/${encodeURIComponent(threadId)}?format=full`,
    token,
    fetchImpl,
  );
  const messages = (thread.messages ?? []).map((m): ThreadMessage => {
    const h = allHeaders(m);
    const millis = Number(m.internalDate);
    return {
      id: m.id ?? "",
      from: h("From"),
      fromName: senderName(h("From")) || addressOf(h("From")),
      fromAddress: addressOf(h("From")),
      to: h("To"),
      cc: h("Cc"),
      date:
        Number.isFinite(millis) && millis > 0
          ? new Date(millis).toISOString()
          : new Date().toISOString(),
      text: messageText(m.payload).slice(0, 60_000),
      html: messageHtml(m.payload),
      snippet: decodeEntities(m.snippet ?? "")
        .replace(/\s+/g, " ")
        .trim(),
      unread: (m.labelIds ?? []).includes("UNREAD"),
      starred: (m.labelIds ?? []).includes("STARRED"),
      attachments: attachmentsOf(m.payload),
    };
  });
  const labelIds = [...new Set((thread.messages ?? []).flatMap((m) => m.labelIds ?? []))];
  if (opts.markRead && messages.some((m) => m.unread)) {
    await modifyThreads(account, [threadId], "read", fetchImpl).catch(() => undefined);
  }
  const first = thread.messages?.[0];
  return {
    id: thread.id ?? threadId,
    account: account.email ?? "",
    subject: (first ? allHeaders(first)("Subject") : "").trim() || "(no subject)",
    labelIds,
    messages,
  };
}

export const ACTIONS = [
  "archive",
  "inbox",
  "read",
  "unread",
  "star",
  "unstar",
  "important",
  "notImportant",
  "trash",
  "untrash",
  "spam",
  "notSpam",
] as const;
export type MailAction = (typeof ACTIONS)[number];

const LABEL_CHANGES: Record<
  Exclude<MailAction, "trash" | "untrash">,
  { add?: string[]; remove?: string[] }
> = {
  archive: { remove: ["INBOX"] },
  inbox: { add: ["INBOX"] },
  read: { remove: ["UNREAD"] },
  unread: { add: ["UNREAD"] },
  star: { add: ["STARRED"] },
  unstar: { remove: ["STARRED"] },
  important: { add: ["IMPORTANT"] },
  notImportant: { remove: ["IMPORTANT"] },
  spam: { add: ["SPAM"], remove: ["INBOX"] },
  notSpam: { add: ["INBOX"], remove: ["SPAM"] },
};

export function isAction(value: unknown): value is MailAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/** Applies one action to whole conversations, as Gmail's own buttons do. */
export async function modifyThreads(
  account: Account,
  threadIds: string[],
  action: MailAction,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const token = await accessTokenFromRefresh(account.refreshToken);
  await pool(threadIds, 5, async (id) => {
    const base = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}`;
    const request =
      action === "trash" || action === "untrash"
        ? fetchImpl(`${base}/${action}`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(12_000),
          })
        : fetchImpl(`${base}/modify`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({
              addLabelIds: LABEL_CHANGES[action].add ?? [],
              removeLabelIds: LABEL_CHANGES[action].remove ?? [],
            }),
            signal: AbortSignal.timeout(12_000),
          });
    const response = await request;
    if (response.status === 403) {
      throw new Error(
        "This account has not allowed changes yet. Reconnect it from the Email page and allow it.",
      );
    }
    if (!response.ok) throw new Error(`Gmail did not change it (${response.status}).`);
  });
}

const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Every address in a typed list, or the first one that is not an address. */
export function parseRecipients(
  value: string,
): { ok: true; list: string[] } | { ok: false; bad: string } {
  const parts = value
    .split(/[,;]/)
    .map((p) => addressOf(p.trim()))
    .filter(Boolean);
  for (const part of parts) if (!ADDRESS.test(part)) return { ok: false, bad: part };
  return { ok: true, list: [...new Set(parts)] };
}

/** A new email — or a forward, which is a new email that quotes another. */
export async function sendNewMail(
  account: Account,
  opts: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; threadId: string }> {
  const token = await accessTokenFromRefresh(account.refreshToken);
  const raw = buildMessage({
    from: account.email ?? "me",
    to: opts.to.join(", "),
    cc: opts.cc.join(", "),
    bcc: opts.bcc.join(", "),
    subject: opts.subject.trim() || "(no subject)",
    body: opts.body,
  });
  return postMessage(token, raw, undefined, fetchImpl);
}

export { splitAddresses };

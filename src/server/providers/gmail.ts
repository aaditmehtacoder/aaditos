/**
 * Gmail adapter — recent mail that might contain a date or a deadline.
 *
 * Uses the same Google connection as Calendar and Classroom, with one extra
 * read-only scope that is asked for separately: Connect Gmail on the
 * Integrations page runs an incremental consent for `gmail.readonly` only. A
 * token granted before that keeps working for everything else, and this
 * adapter reports "not connected" rather than breaking.
 *
 * Read-only throughout. Nothing here can send, archive, label or delete.
 * The query skips promotions and social mail; a club email with four dates
 * in it is exactly what should get through.
 *
 * Every connected account with the Gmail permission is read, side by side:
 * each item says which mailbox it came from and opens in that account.
 */

import type { InboxItem } from "@/lib/integrations/contracts";

import { accessTokenFromRefresh, googleConfigured } from "./google";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailHeader {
  name?: string;
  value?: string;
}

export interface GmailMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[] };
}

/** Recent inbox mail, newest first, without promotions and social. */
export const INBOX_QUERY = "in:inbox newer_than:14d -category:promotions -category:social";
const PER_ACCOUNT = 25;

function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find(
    (h) => (h.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

/** "Jane Doe <jane@x.org>" → "Jane Doe"; a bare address stays as is. */
export function senderName(from: string): string {
  const match = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(from.trim());
  return (match?.[1] ?? from).trim();
}

/** Opens the thread in the right account, not whichever is signed in first. */
export function gmailUrl(threadId: string, account?: string): string {
  const who = account ? `?authuser=${encodeURIComponent(account)}` : "";
  return `https://mail.google.com/mail/${who}#all/${threadId}`;
}

/** Pure: Gmail message resources → inbox items. Exported for tests. */
export function normalizeGmailMessages(messages: unknown, account?: string): InboxItem[] {
  if (!Array.isArray(messages)) return [];
  const out: InboxItem[] = [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") continue;
    const message = entry as GmailMessage;
    if (!message.id) continue;
    const subject = header(message, "Subject").trim() || "(no subject)";
    const from = senderName(header(message, "From"));
    const snippet = (message.snippet ?? "").replace(/\s+/g, " ").trim();
    const millis = Number(message.internalDate);
    out.push({
      id: `gmail:${message.id}`,
      source: "gmail",
      title: subject,
      detail: snippet ? snippet.slice(0, 200) : undefined,
      from: from || undefined,
      url: account
        ? gmailUrl(message.threadId ?? message.id, account)
        : `https://mail.google.com/mail/u/0/#inbox/${message.threadId ?? message.id}`,
      account,
      unread: (message.labelIds ?? []).includes("UNREAD"),
      at:
        Number.isFinite(millis) && millis > 0
          ? new Date(millis).toISOString()
          : new Date().toISOString(),
    });
  }
  return out;
}

export async function api<T>(
  path: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(`${API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 403) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(
      /insufficient|scope/i.test(body.error?.message ?? "")
        ? "Gmail is not connected yet. Use Connect Gmail on the Integrations page."
        : (body.error?.message ?? "Gmail denied the request (403)."),
    );
  }
  if (!response.ok) throw new Error(`Gmail returned ${response.status}`);
  return (await response.json()) as T;
}

export interface GmailAccountSummary {
  email: string;
  ok: boolean;
  /** Unread conversations in the inbox, all of them, not just the recent ones listed. */
  unread?: number | undefined;
  error?: string | undefined;
}

export interface GmailResult {
  configured: boolean;
  /** True once at least one connected account carries the Gmail scope. */
  connected: boolean;
  ok: boolean;
  items: InboxItem[];
  accounts: GmailAccountSummary[];
  error?: string;
}

export interface GmailAccountInput {
  refreshToken: string;
  grantedScope: string;
  email?: string | undefined;
}

async function fetchOne(
  account: GmailAccountInput,
  fetchImpl: typeof fetch,
): Promise<{ items: InboxItem[]; summary: GmailAccountSummary }> {
  const email = account.email ?? "Gmail";
  try {
    const accessToken = await accessTokenFromRefresh(account.refreshToken);
    const [list, inbox] = await Promise.all([
      api<{ messages?: Array<{ id?: string }> }>(
        `/messages?maxResults=${PER_ACCOUNT}&q=${encodeURIComponent(INBOX_QUERY)}`,
        accessToken,
        fetchImpl,
      ),
      api<{ threadsUnread?: number }>("/labels/INBOX", accessToken, fetchImpl).catch(() => null),
    ]);
    const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    const messages = await Promise.all(
      ids.map((id) =>
        api<GmailMessage>(
          `/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          accessToken,
          fetchImpl,
        ).catch(() => null),
      ),
    );
    return {
      items: normalizeGmailMessages(messages.filter(Boolean), account.email),
      summary: { email, ok: true, unread: inbox?.threadsUnread },
    };
  } catch (error) {
    return {
      items: [],
      summary: {
        email,
        ok: false,
        error: error instanceof Error ? error.message : "Gmail request failed",
      },
    };
  }
}

export async function fetchGmail(
  opts: { accounts: GmailAccountInput[] },
  fetchImpl: typeof fetch = fetch,
): Promise<GmailResult> {
  if (!googleConfigured()) {
    return {
      configured: false,
      connected: false,
      ok: false,
      items: [],
      accounts: [],
      error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the server.",
    };
  }
  const withMail = opts.accounts.filter((a) => a.grantedScope.split(" ").includes(GMAIL_SCOPE));
  if (withMail.length === 0) {
    return {
      configured: true,
      connected: false,
      ok: false,
      items: [],
      accounts: [],
      error: "Gmail is not connected yet. Use Connect Gmail on the Integrations page.",
    };
  }

  const results = await Promise.all(withMail.map((a) => fetchOne(a, fetchImpl)));
  const failed = results.filter((r) => !r.summary.ok);
  return {
    configured: true,
    connected: true,
    // One mailbox failing must not hide the others.
    ok: failed.length < results.length,
    items: results.flatMap((r) => r.items).sort((a, b) => b.at.localeCompare(a.at)),
    accounts: results.map((r) => r.summary),
    ...(failed.length > 0
      ? { error: failed.map((r) => `${r.summary.email}: ${r.summary.error}`).join(" · ") }
      : {}),
  };
}

// ---- reading one message, and replying to it ------------------------------

/** Sending only: it cannot read, delete or change anything on its own. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

export interface FullMessage extends GmailMessage {
  payload?: GmailPart & { headers?: GmailHeader[] };
}

export interface GmailMessageView {
  id: string;
  threadId: string;
  account: string;
  subject: string;
  from: string;
  /** Just the address, for replying. Reply-To wins when the sender set one. */
  replyTo: string;
  to: string;
  cc: string;
  date: string;
  /** The message as plain text; HTML-only mail is converted, never rendered. */
  text: string;
  unread: boolean;
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** UTF-8 text → base64, a byte at a time: spreading a long body into one call overflows the stack. */
function utf8Base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeBase64Url(text: string): string {
  return utf8Base64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Readable text from an HTML email: structure kept as line breaks, everything else dropped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The best plain-text body in a MIME tree: text/plain first, then HTML turned into text. */
export function messageText(part: GmailPart | undefined): string {
  if (!part) return "";
  const find = (p: GmailPart, type: string): string | null => {
    if (p.mimeType === type && p.body?.data && !p.filename) return decodeBase64Url(p.body.data);
    for (const child of p.parts ?? []) {
      const found = find(child, type);
      if (found) return found;
    }
    return null;
  };
  const plain = find(part, "text/plain");
  if (plain) return plain.replace(/\r\n/g, "\n").trim();
  const html = find(part, "text/html");
  return html ? htmlToText(html) : "";
}

/** "Jane <jane@x.org>" → "jane@x.org". */
export function addressOf(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

export function allHeaders(message: FullMessage): (name: string) => string {
  return (name) =>
    message.payload?.headers?.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())
      ?.value ?? "";
}

export async function fetchGmailMessage(
  account: { refreshToken: string; email?: string | undefined },
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailMessageView> {
  const accessToken = await accessTokenFromRefresh(account.refreshToken);
  const message = await api<FullMessage>(
    `/messages/${encodeURIComponent(id)}?format=full`,
    accessToken,
    fetchImpl,
  );
  const h = allHeaders(message);
  return {
    id: message.id ?? id,
    threadId: message.threadId ?? id,
    account: account.email ?? "",
    subject: h("Subject") || "(no subject)",
    from: h("From"),
    replyTo: addressOf(h("Reply-To") || h("From")),
    to: h("To"),
    cc: h("Cc"),
    date: h("Date"),
    text: messageText(message.payload).slice(0, 60_000),
    unread: (message.labelIds ?? []).includes("UNREAD"),
  };
}

/** No line breaks in a header value: that is how a header gets injected. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047, so a subject with accents or emoji survives every mail server. */
function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${utf8Base64(value)}?=`;
}

/** One address per entry from a header like `"Doe, Jane" <j@x.org>, k@y.org`. */
export function splitAddresses(header: string): string[] {
  return (header.match(/"[^"]*"\s*<[^>]+>|[^,]+/g) ?? [])
    .map((part) => addressOf(part))
    .filter((address) => /^[^\s@<>]+@[^\s@<>]+$/.test(address));
}

/**
 * A raw RFC 2822 message, ready for `messages.send`: optional Cc and Bcc,
 * threaded onto an original with In-Reply-To and References when given, the
 * original quoted underneath the way mail clients do, and the body in base64
 * so any language goes through. Every header value is kept to one line.
 */
export function buildMessage(opts: {
  from: string;
  to: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  subject: string;
  body: string;
  messageId?: string | undefined;
  references?: string | undefined;
  quote?: { date: string; from: string; text: string } | undefined;
}): string {
  const quoted = opts.quote
    ? `\n\nOn ${oneLine(opts.quote.date)}, ${oneLine(opts.quote.from)} wrote:\n` +
      opts.quote.text
        .split("\n")
        .slice(0, 80)
        .map((line) => `> ${line}`)
        .join("\n")
    : "";
  const body = utf8Base64(`${opts.body.trim()}${quoted}\n`).replace(/.{76}/g, "$&\r\n");
  const references = [opts.references ?? "", opts.messageId ?? ""]
    .map(oneLine)
    .filter(Boolean)
    .join(" ");
  const headers = [
    `From: ${oneLine(opts.from)}`,
    `To: ${oneLine(opts.to)}`,
    ...(opts.cc?.trim() ? [`Cc: ${oneLine(opts.cc)}`] : []),
    ...(opts.bcc?.trim() ? [`Bcc: ${oneLine(opts.bcc)}`] : []),
    `Subject: ${encodeHeaderWord(oneLine(opts.subject))}`,
    ...(opts.messageId ? [`In-Reply-To: ${oneLine(opts.messageId)}`] : []),
    ...(references ? [`References: ${references}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${body}`);
}

/** A reply: the same message, with "Re:" once and the threading headers required. */
export function buildReply(opts: {
  from: string;
  to: string;
  cc?: string | undefined;
  subject: string;
  messageId: string;
  references: string;
  body: string;
  quote?: { date: string; from: string; text: string } | undefined;
}): string {
  const subject = /^re:/i.test(opts.subject.trim())
    ? opts.subject.trim()
    : `Re: ${opts.subject.trim()}`;
  return buildMessage({ ...opts, subject });
}

/** Hands a raw message to Gmail, optionally onto a thread. */
export async function postMessage(
  accessToken: string,
  raw: string,
  threadId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; threadId: string }> {
  const response = await fetchImpl(`${API}/messages/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 403) {
    throw new Error(
      "This account has not allowed sending yet. Reconnect it from the Email page and allow it.",
    );
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(detail.error?.message ?? `Gmail did not send it (${response.status}).`);
  }
  const sent = (await response.json()) as { id?: string; threadId?: string };
  return { id: sent.id ?? "", threadId: sent.threadId ?? threadId ?? "" };
}

/**
 * Replies to one message from the account it arrived in. Every header comes
 * from the original as Gmail has it, not from the browser, so a reply can
 * only ever go back to the people already on the email. Reply all adds the
 * original's To and Cc, minus the sender's own address.
 */
export async function sendGmailReply(
  account: { refreshToken: string; email?: string | undefined },
  id: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
  opts: { all?: boolean } = {},
): Promise<{ id: string; threadId: string; to: string; cc: string }> {
  const accessToken = await accessTokenFromRefresh(account.refreshToken);
  const original = await api<FullMessage>(
    `/messages/${encodeURIComponent(id)}?format=full`,
    accessToken,
    fetchImpl,
  );
  const h = allHeaders(original);
  const self = (account.email ?? "").toLowerCase();
  const fromSelf = addressOf(h("From")).toLowerCase() === self;
  // Replying to something you sent goes to the people you sent it to.
  const to = fromSelf ? splitAddresses(h("To")).join(", ") : addressOf(h("Reply-To") || h("From"));
  if (!to || !/@/.test(to)) throw new Error("That email has no address to reply to.");
  const already = new Set([self, ...splitAddresses(to).map((a) => a.toLowerCase())]);
  const cc = opts.all
    ? [...new Set([...splitAddresses(h("To")), ...splitAddresses(h("Cc"))])]
        .filter((a) => !already.has(a.toLowerCase()))
        .join(", ")
    : "";
  const raw = buildReply({
    from: account.email ?? "me",
    to,
    cc,
    subject: h("Subject") || "(no subject)",
    messageId: h("Message-ID") || h("Message-Id"),
    references: h("References"),
    body,
    quote: { date: h("Date"), from: h("From"), text: messageText(original.payload) },
  });
  const sent = await postMessage(accessToken, raw, original.threadId, fetchImpl);
  return { ...sent, to, cc };
}

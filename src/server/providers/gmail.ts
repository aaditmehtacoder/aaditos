/**
 * Gmail adapter — read-only, and never a full mailbox scan.
 *
 * The scope is `gmail.readonly`, but the *query* is the real privacy boundary:
 * every fetch is filtered by a Gmail search string, so only messages matching
 * it are ever read. `DEFAULT_QUERY` targets the mail that actually carries
 * deadlines — club and school announcements from the last few weeks — rather
 * than everything in the inbox.
 *
 * Nothing here writes, sends, deletes, or labels. Attachments are never
 * downloaded; only the text/plain body is read, and it is capped so one
 * newsletter cannot blow up a model request.
 */

import type { GmailResult, InboxMessage } from "@/lib/integrations/contracts";

import { accessTokenFromRefresh, googleConfigured } from "./google";

export type { GmailResult, InboxMessage };

/**
 * Announcement mail from clubs, teachers and the district, recent enough to
 * still be actionable. Deliberately narrow: no promotions, no social, no chat.
 */
export const DEFAULT_QUERY =
  "newer_than:30d -category:promotions -category:social " +
  "(club OR meeting OR volunteer OR deadline OR assignment OR tryout OR " +
  "rehearsal OR competition OR practice OR fundraiser OR sign-up OR signup)";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_BODY_CHARS = 6000;

/** Gmail's base64url payload encoding, decoded to text. */
function decodeBody(data: string): string {
  try {
    const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

/** Enough HTML reduction to keep dates, times and room numbers intact. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

/**
 * Walks the MIME tree for readable text, preferring text/plain. Parts with a
 * filename are attachments and are skipped entirely.
 */
export function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";

  const plain: string[] = [];
  const html: string[] = [];

  const walk = (part: GmailPart) => {
    if (part.filename) return;
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    if (data) {
      if (mime === "text/plain") plain.push(decodeBody(data));
      else if (mime === "text/html") html.push(decodeBody(data));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  const text = plain.length > 0 ? plain.join("\n") : htmlToText(html.join("\n"));
  return text.slice(0, MAX_BODY_CHARS);
}

interface MessageRow {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> };
}

export function normalizeMessage(row: MessageRow): InboxMessage | null {
  if (!row.id) return null;
  const headers = row.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const subject = header("subject").trim();
  const body = extractBody(row.payload);
  // A message with neither subject nor body has nothing to extract from.
  if (!subject && !body) return null;

  // internalDate is epoch ms and always present; the Date header can be absent
  // or malformed, so it is only a fallback.
  const epoch = Number(row.internalDate);
  const receivedAt =
    Number.isFinite(epoch) && epoch > 0
      ? new Date(epoch).toISOString()
      : new Date(header("date") || Date.now()).toISOString();

  return {
    id: row.id,
    threadId: row.threadId ?? row.id,
    from: header("from").trim(),
    subject: subject || "(no subject)",
    receivedAt,
    snippet: (row.snippet ?? "").trim(),
    body,
    externalUrl: `https://mail.google.com/mail/u/0/#inbox/${row.threadId ?? row.id}`,
  };
}

async function api<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 403) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = body.error?.message ?? "";
    throw new Error(
      /insufficient|scope/i.test(message)
        ? "Gmail access was not granted. Reconnect Google in Integrations to add the Gmail scope."
        : /disabled/i.test(message)
          ? "Your school's Google Workspace administrator has blocked Gmail API access."
          : message || "Google denied the Gmail request (403).",
    );
  }
  if (!response.ok) throw new Error(`Gmail API returned ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchGmail(opts: {
  refreshToken: string | null;
  query?: string | undefined;
  max?: number | undefined;
}): Promise<GmailResult> {
  const query = (opts.query?.trim() || DEFAULT_QUERY).slice(0, 500);
  const base = { configured: googleConfigured(), connected: false, ok: false, query, messages: [] };

  if (!base.configured) {
    return {
      ...base,
      error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the server.",
    };
  }
  if (!opts.refreshToken) {
    return { ...base, error: "Google is not connected yet. Use Connect on the Integrations page." };
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenFromRefresh(opts.refreshToken);
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "Could not refresh Google access.",
    };
  }

  const max = Math.min(Math.max(opts.max ?? 15, 1), 40);

  try {
    const list = await api<{ messages?: Array<{ id?: string }> }>(
      `/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
      accessToken,
    );
    const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));

    // `format=full` is needed for bodies; metadata alone gives only headers.
    const rows = await Promise.all(
      ids.map((id) =>
        api<MessageRow>(`/messages/${id}?format=full`, accessToken).catch(() => null),
      ),
    );

    const messages = rows
      .filter((row): row is MessageRow => row !== null)
      .map(normalizeMessage)
      .filter((m): m is InboxMessage => m !== null)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    return {
      configured: true,
      connected: true,
      ok: true,
      query,
      messages,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      configured: true,
      connected: true,
      ok: false,
      query,
      messages: [],
      error: error instanceof Error ? error.message : "Gmail request failed.",
    };
  }
}

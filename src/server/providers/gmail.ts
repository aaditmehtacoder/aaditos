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

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessage {
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

async function api<T>(path: string, accessToken: string, fetchImpl: typeof fetch): Promise<T> {
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

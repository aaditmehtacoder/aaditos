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
  payload?: { headers?: GmailHeader[] };
}

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

/** Pure: Gmail message resources → inbox items. Exported for tests. */
export function normalizeGmailMessages(messages: unknown): InboxItem[] {
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
      url: `https://mail.google.com/mail/u/0/#inbox/${message.threadId ?? message.id}`,
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

export interface GmailResult {
  configured: boolean;
  /** True once the stored token carries the Gmail scope. */
  connected: boolean;
  ok: boolean;
  items: InboxItem[];
  error?: string;
}

export async function fetchGmail(
  opts: { refreshToken: string | null; grantedScope: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GmailResult> {
  if (!googleConfigured()) {
    return {
      configured: false,
      connected: false,
      ok: false,
      items: [],
      error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the server.",
    };
  }
  if (!opts.refreshToken || !opts.grantedScope.split(" ").includes(GMAIL_SCOPE)) {
    return {
      configured: true,
      connected: false,
      ok: false,
      items: [],
      error: "Gmail is not connected yet. Use Connect Gmail on the Integrations page.",
    };
  }

  try {
    const accessToken = await accessTokenFromRefresh(opts.refreshToken);
    const query = "newer_than:7d -category:promotions -category:social -in:spam -in:trash";
    const list = await api<{ messages?: Array<{ id?: string }> }>(
      `/messages?maxResults=20&q=${encodeURIComponent(query)}`,
      accessToken,
      fetchImpl,
    );
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
      configured: true,
      connected: true,
      ok: true,
      items: normalizeGmailMessages(messages.filter(Boolean)).sort((a, b) =>
        b.at.localeCompare(a.at),
      ),
    };
  } catch (error) {
    return {
      configured: true,
      connected: true,
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : "Gmail request failed",
    };
  }
}

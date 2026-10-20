/**
 * Slack adapter — messages that mention you.
 *
 * A user token (xoxp-…) with `search:read` and `users:read`, from a Slack app
 * installed to the workspace. One `search.messages` call for your own mention
 * in the last week, plus your direct messages. Read-only: nothing here posts.
 *
 * Why a user token and not a bot: a bot only sees channels it was invited
 * to, and mention search is a user-scoped API.
 */

import type { InboxItem } from "@/lib/integrations/contracts";

import { serverEnv } from "../env";

const API = "https://slack.com/api";

export function slackConfigured(): boolean {
  return Boolean(serverEnv.slackUserToken);
}

interface SlackMatch {
  iid?: string;
  ts?: string;
  text?: string;
  permalink?: string;
  username?: string;
  user?: string;
  channel?: { id?: string; name?: string; is_im?: boolean };
}

/** Pure: Slack search matches → inbox items. Exported for tests. */
export function normalizeSlackMatches(matches: unknown, selfId: string): InboxItem[] {
  if (!Array.isArray(matches)) return [];
  const out: InboxItem[] = [];
  for (const entry of matches) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as SlackMatch;
    const text = (row.text ?? "")
      .replace(/<@[A-Z0-9]+>/g, "@you")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || !row.ts) continue;
    // Your own messages come back from a mention search; skip them.
    if (row.user && row.user === selfId) continue;
    const channel = row.channel?.is_im ? "DM" : row.channel?.name ? `#${row.channel.name}` : "";
    const seconds = Number(row.ts.split(".")[0]);
    out.push({
      id: `slack:${row.channel?.id ?? "c"}:${row.ts}`,
      source: "slack",
      title: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      detail: channel || undefined,
      from: row.username ?? undefined,
      url: row.permalink,
      at: Number.isFinite(seconds)
        ? new Date(seconds * 1000).toISOString()
        : new Date().toISOString(),
    });
  }
  return out;
}

async function call<T>(
  method: string,
  params: Record<string, string>,
  token: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${API}/${method}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!data.ok) {
    const code = data.error ?? `HTTP ${response.status}`;
    throw new Error(
      code === "invalid_auth" || code === "token_revoked"
        ? "Slack rejected the token. Reinstall the app and paste the new user token."
        : code === "missing_scope"
          ? "The Slack token needs the search:read and users:read scopes."
          : `Slack: ${code}`,
    );
  }
  return data;
}

export interface SlackResult {
  configured: boolean;
  ok: boolean;
  items: InboxItem[];
  error?: string;
}

export async function fetchSlack(fetchImpl: typeof fetch = fetch): Promise<SlackResult> {
  const token = serverEnv.slackUserToken;
  if (!token) {
    return { configured: false, ok: false, items: [], error: "SLACK_USER_TOKEN is not set." };
  }
  try {
    const me = await call<{ user_id?: string }>("auth.test", {}, token, fetchImpl);
    const selfId = me.user_id ?? "";
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const [mentions, dms] = await Promise.all([
      call<{ messages?: { matches?: unknown } }>(
        "search.messages",
        { query: `<@${selfId}> after:${since}`, sort: "timestamp", sort_dir: "desc", count: "20" },
        token,
        fetchImpl,
      ),
      call<{ messages?: { matches?: unknown } }>(
        "search.messages",
        { query: `is:dm after:${since}`, sort: "timestamp", sort_dir: "desc", count: "20" },
        token,
        fetchImpl,
      ).catch(() => ({ messages: { matches: [] } })),
    ]);
    const items = new Map<string, InboxItem>();
    for (const item of [
      ...normalizeSlackMatches(mentions.messages?.matches, selfId),
      ...normalizeSlackMatches(dms.messages?.matches, selfId),
    ]) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
    return {
      configured: true,
      ok: true,
      items: [...items.values()].sort((a, b) => b.at.localeCompare(a.at)),
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      items: [],
      error: error instanceof Error ? error.message : "Slack request failed",
    };
  }
}

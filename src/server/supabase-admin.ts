/**
 * Server-side Supabase access with the service-role key.
 *
 * Only the scheduled sync uses this. Everything a signed-in browser does still
 * goes through the anon key and Row Level Security — the service role bypasses
 * RLS entirely, so it must never be reachable from a request a user controls.
 *
 * Plain `fetch` against PostgREST rather than the JS client: this runs in an
 * edge-ish serverless function where the smaller dependency and the explicit
 * request shape are both worth more than the client's ergonomics.
 */

import type { CalendarEvent } from "@/lib/core/types";

import { serverEnv } from "./env";

export interface AdminConfig {
  url: string;
  key: string;
}

/** Null when the service role is not configured, which disables scheduled writes. */
export function adminConfig(): AdminConfig | null {
  const url = serverEnv.supabaseUrl;
  const key = serverEnv.supabaseServiceRoleKey;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function rest(
  config: AdminConfig,
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: config.key,
    authorization: `Bearer ${config.key}`,
    "content-type": "application/json",
  };
  if (init.prefer) headers["prefer"] = init.prefer;
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`supabase ${path} → ${response.status} ${detail.slice(0, 200)}`);
  }
  return response;
}

/**
 * Every account.
 *
 * `profiles`, not `user_preferences`. A profile row is created by a trigger the
 * moment an account is created, so this is genuinely every account. A
 * preferences row only appears once someone changes a setting — so reading
 * from there meant a person who had never opened Settings was invisible to the
 * scheduled sync, and it quietly wrote to nobody at all on a fresh database.
 * That failure is silent by construction: an empty list is not an error.
 */
export async function listActiveUserIds(config: AdminConfig): Promise<string[]> {
  const response = await rest(config, "/profiles?select=id");
  const rows = (await response.json()) as Array<{ id: string }>;
  return [...new Set(rows.map((r) => r.id).filter(Boolean))];
}

/**
 * Replace one calendar's events for one user.
 *
 * Delete-then-insert per calendar, which is what makes a re-run idempotent:
 * an event cancelled at school disappears here too, instead of lingering
 * forever because nothing ever removed it.
 */
export async function replaceEventsForUser(
  config: AdminConfig,
  userId: string,
  calendarIds: string[],
  events: CalendarEvent[],
): Promise<number> {
  if (calendarIds.length > 0) {
    const list = calendarIds.map((id) => `"${id}"`).join(",");
    await rest(config, `/events?user_id=eq.${userId}&calendar_id=in.(${list})`, {
      method: "DELETE",
    });
  }
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
    id: e.id,
    user_id: userId,
    title: e.title,
    description: e.description ?? null,
    location: e.location ?? null,
    start_at: e.startAt,
    end_at: e.endAt ?? null,
    all_day: e.allDay,
    kind: e.kind,
    source: e.source,
    calendar_id: e.calendarId,
    source_ref: e.sourceRef ?? null,
    external_url: e.externalUrl ?? null,
  }));

  // Chunked: one 500-event calendar in a single request is a payload large
  // enough to hit a gateway limit on a bad day.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await rest(config, "/events?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: JSON.stringify(rows.slice(i, i + CHUNK)),
    });
  }
  return rows.length;
}

/** Record what the scheduled run did, so the UI can show when it last ran. */
export async function recordSyncRunForUser(
  config: AdminConfig,
  userId: string,
  run: {
    id: string;
    provider: string;
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    imported: number;
    message: string;
  },
): Promise<void> {
  await rest(config, "/sync_runs", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify([
      {
        id: run.id,
        user_id: userId,
        provider: run.provider,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        ok: run.ok,
        imported: run.imported,
        updated: 0,
        skipped: 0,
        message: run.message,
      },
    ]),
  });
}

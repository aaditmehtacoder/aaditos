/**
 * Provider synchronization.
 *
 * Three providers, and every one runs independently with its failure captured
 * rather than thrown — a lapsed Google consent must never stop the Wilcox
 * calendar or the weather from syncing. Each reports a `SyncRunResult` the UI
 * can display verbatim.
 */

import { dedupeEvents, normalizeEvent } from "@/lib/core/normalize";
import { SYNCABLE } from "@/lib/integrations/contracts";
import type { SyncPayload, SyncProvider, SyncRunResult } from "@/lib/integrations/contracts";

import { fetchGoogle } from "./providers/google";
import { readGoogleSession } from "./google-session";
import { fetchWeather } from "./providers/weather";
import { WILCOX_CALENDARS, fetchWilcoxEvents } from "./providers/wilcox";

export { SYNCABLE };
export type { SyncPayload, SyncProvider, SyncRunResult };

export interface SyncOptions {
  providers: SyncProvider[];
  userId: string;
}

/** Retry a transient failure once with a short backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastError;
}

export async function runSync(opts: SyncOptions): Promise<SyncPayload> {
  const payload: SyncPayload = { runs: [] };
  const wanted = new Set(opts.providers);

  const tasks: Array<Promise<void>> = [];

  if (wanted.has("wilcox")) {
    tasks.push(
      run("wilcox", payload, async () => {
        const result = await withRetry(() => fetchWilcoxEvents({ months: 3 }));
        const normalized = result.events.map((raw) => normalizeEvent(raw, { userId: opts.userId }));
        const deduped = dedupeEvents(normalized);
        payload.wilcox = {
          events: deduped.events,
          calendarIds: WILCOX_CALENDARS.map((c) => c.id),
          duplicatesRemoved: deduped.duplicates.length,
        };
        const failedAll = result.fetchedCalendars.length === 0;
        return {
          ok: !failedAll,
          imported: deduped.events.length,
          updated: 0,
          skipped: deduped.duplicates.length,
          message: failedAll
            ? `Wilcox fetch failed: ${result.errors[0]?.message ?? "no calendars reachable"}`
            : `${deduped.events.length} events from ${result.fetchedCalendars.length} calendars` +
              (result.errors.length ? ` · ${result.errors.length} month(s) unavailable` : ""),
          needsCredentials: false,
        };
      }),
    );
  }

  if (wanted.has("google")) {
    tasks.push(
      run("google", payload, async () => {
        const session = await readGoogleSession();
        const result = await fetchGoogle({
          refreshToken: session.refreshToken ?? null,
          userId: opts.userId,
        });
        payload.google = result;
        if (!result.configured || !result.connected) {
          return {
            ok: false,
            imported: 0,
            updated: 0,
            skipped: 0,
            message: result.error ?? "Google is not connected",
            needsCredentials: true,
          };
        }
        return {
          ok: result.ok,
          imported: result.events.length + result.courses.length + result.assignments.length,
          updated: 0,
          skipped: 0,
          message: result.ok
            ? `${result.events.length} events, ${result.courses.length} courses, ${result.assignments.length} assignments` +
              (result.error ? ` · ${result.error}` : "")
            : (result.error ?? "Google request failed"),
          needsCredentials: false,
        };
      }),
    );
  }

  if (wanted.has("weather")) {
    tasks.push(
      run("weather", payload, async () => {
        const result = await fetchWeather();
        payload.weather = result;
        return {
          ok: result.ok,
          imported: result.ok ? 1 : 0,
          updated: 0,
          skipped: 0,
          message: result.ok
            ? `${result.tempF}°F · ${result.condition}`
            : (result.error ?? "Weather unavailable"),
          needsCredentials: false,
        };
      }),
    );
  }

  await Promise.all(tasks);
  payload.runs.sort((a, b) => a.provider.localeCompare(b.provider));
  return payload;
}

async function run(
  provider: SyncProvider,
  payload: SyncPayload,
  fn: () => Promise<Omit<SyncRunResult, "provider" | "startedAt" | "finishedAt">>,
): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const result = await fn();
    payload.runs.push({ provider, startedAt, finishedAt: new Date().toISOString(), ...result });
  } catch (error) {
    // Structured log without payload contents or credentials.
    console.error("[sync] provider failed", {
      provider,
      message: error instanceof Error ? error.message : "unknown",
    });
    payload.runs.push({
      provider,
      ok: false,
      imported: 0,
      updated: 0,
      skipped: 0,
      message: error instanceof Error ? error.message : "Provider failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      needsCredentials: false,
    });
  }
}

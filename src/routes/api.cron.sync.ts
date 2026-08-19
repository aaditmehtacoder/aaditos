import { createFileRoute } from "@tanstack/react-router";

import { newId } from "@/lib/core/ids";
import { serverEnv } from "@/server/env";
import {
  adminConfig,
  listActiveUserIds,
  recordSyncRunForUser,
  replaceEventsForUser,
} from "@/server/supabase-admin";
import { runSync } from "@/server/sync";

/**
 * Scheduled sync.
 *
 * This used to only warm the server's provider caches, which meant the data in
 * anyone's account was exactly as fresh as the last time they opened the app.
 * Now it writes: it fetches the Wilcox calendars once, then persists the
 * normalized result into every active account with the service-role key. Open
 * the app after three days away and the week is already correct.
 *
 * Google is deliberately not here. Its refresh token lives in a sealed cookie
 * belonging to one browser session, which a scheduled run does not have — and
 * an unattended retry against lapsed consent would just produce an error every
 * few minutes. Google syncs from the browser, where a human can re-consent.
 *
 * Protected by `CRON_SECRET`, sent as `Authorization: Bearer <secret>` (what
 * Vercel Cron and the GitHub Actions schedule both do) or as `?secret=`.
 */
export const Route = createFileRoute("/api/cron/sync")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const secret = serverEnv.cronSecret;
  if (!secret) {
    return json(
      { ok: false, error: "CRON_SECRET is not configured; scheduled sync is disabled." },
      503,
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = new URL(request.url).searchParams.get("secret") ?? "";
  if (!timingSafeEqual(bearer || query, secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const startedAt = new Date().toISOString();
  const payload = await runSync({ providers: ["wilcox", "weather"], userId: "cron" });

  // Fetching succeeded or it did not; persisting is a separate outcome, and
  // reporting them together would hide a silent write failure behind a green
  // fetch. Both are returned.
  let usersWritten = 0;
  let eventsWritten = 0;
  let writeError: string | undefined;

  const config = adminConfig();
  const wilcox = payload.wilcox;

  if (config && wilcox && wilcox.events.length > 0) {
    try {
      const userIds = await listActiveUserIds(config);
      const finishedAt = new Date().toISOString();
      for (const userId of userIds) {
        // The rows carry the cron's placeholder id from normalization; each
        // account has to own its own copy.
        const events = wilcox.events.map((event) => ({ ...event, userId }));
        const written = await replaceEventsForUser(config, userId, wilcox.calendarIds, events);
        eventsWritten += written;
        usersWritten += 1;
        await recordSyncRunForUser(config, userId, {
          id: newId(),
          provider: "wilcox",
          startedAt,
          finishedAt,
          ok: true,
          imported: written,
          message: `${written} events from the scheduled sync`,
        });
      }
    } catch (error) {
      // A failed write must not fail the endpoint: the fetch still succeeded,
      // and returning 500 would make the schedule look broken when it is not.
      writeError = error instanceof Error ? error.message : "write failed";
      console.error("[cron] persisting sync failed", { message: writeError });
    }
  }

  console.info("[cron] sync complete", {
    runs: payload.runs.map((r) => ({ provider: r.provider, ok: r.ok })),
    usersWritten,
    eventsWritten,
  });

  return json({
    ok: payload.runs.every((r) => r.ok || r.needsCredentials) && !writeError,
    ranAt: new Date().toISOString(),
    usersWritten,
    eventsWritten,
    ...(writeError ? { writeError } : {}),
    ...(config ? {} : { note: "Supabase service role not configured; nothing was persisted." }),
    runs: payload.runs.map((r) => ({
      provider: r.provider,
      ok: r.ok,
      message: r.message,
      needsCredentials: r.needsCredentials,
    })),
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

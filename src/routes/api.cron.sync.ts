import { createFileRoute } from "@tanstack/react-router";

import { serverEnv } from "@/server/env";
import { runSync } from "@/server/sync";

/**
 * Scheduled sync endpoint (Vercel Cron).
 *
 * Protected by `CRON_SECRET`, sent either as `Authorization: Bearer <secret>`
 * (what Vercel Cron does) or `?secret=`.
 *
 * What it actually does: refreshes the server-side provider caches — the Wilcox
 * calendar HTML, weather, GitHub, Vercel and Spotify responses — so the next
 * client sync is instant and rate limits stay low. It does not write to a
 * user's workspace, because in the default configuration the workspace lives in
 * the browser. With Supabase configured, extend this handler to persist through
 * `SupabaseRepository` using the service-role key.
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

  const payload = await runSync({
    providers: ["wilcox", "weather", "github", "vercel", "spotify"],
    userId: "cron",
    githubRepos: [],
  });

  console.info("[cron] sync complete", {
    runs: payload.runs.map((r) => ({ provider: r.provider, ok: r.ok })),
  });

  return json({
    ok: payload.runs.every((r) => r.ok || r.needsCredentials),
    ranAt: new Date().toISOString(),
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

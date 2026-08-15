import { createFileRoute } from "@tanstack/react-router";

import { serverEnv } from "@/server/env";
import { pushConfigured, sendPush } from "@/server/push";

/**
 * Scheduled push (Vercel Cron).
 *
 * Sends one payload-less tickle to every stored subscription. Each service
 * worker then fetches `/api/push/next` and shows whatever is actually pending
 * for that user — so this endpoint never needs to know, or transmit, what any
 * notification says.
 *
 * Subscriptions the push service reports as gone (404/410) are deleted here.
 * Without that, a Chromebook that was reset would collect failures forever.
 *
 * Protected by `CRON_SECRET`, the same way `/api/cron/sync` is.
 */
export const Route = createFileRoute("/api/cron/push")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

async function handle(request: Request): Promise<Response> {
  const secret = serverEnv.cronSecret;
  if (!secret) {
    return json({ ok: false, error: "CRON_SECRET is not configured." }, 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = new URL(request.url).searchParams.get("secret") ?? "";
  if (!timingSafeEqual(bearer || query, secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (!pushConfigured()) {
    return json({ ok: false, error: "VAPID keys are not configured." }, 503);
  }

  const url = serverEnv.supabaseUrl;
  const key = serverEnv.supabaseServiceRoleKey;
  if (!url || !key) {
    return json({ ok: false, error: "Supabase is not configured." }, 503);
  }

  let rows: SubscriptionRow[] = [];
  try {
    const response = await fetch(
      `${url}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&limit=500`,
      { headers: { apikey: key, authorization: `Bearer ${key}` } },
    );
    if (!response.ok) {
      return json({ ok: false, error: `Could not list subscriptions (${response.status})` }, 502);
    }
    rows = (await response.json()) as SubscriptionRow[];
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Query failed." },
      502,
    );
  }

  let sent = 0;
  let failed = 0;
  const expired: string[] = [];

  // Sequential on purpose: a handful of subscriptions is not worth the
  // concurrency, and push services rate-limit bursts from one origin.
  for (const row of rows) {
    const result = await sendPush({
      endpoint: row.endpoint,
      p256dh: row.p256dh ?? undefined,
      auth: row.auth ?? undefined,
    });
    if (result.ok) sent += 1;
    else failed += 1;
    if (result.expired) expired.push(row.id);
  }

  if (expired.length > 0) {
    await fetch(`${url}/rest/v1/push_subscriptions?id=in.(${expired.join(",")})`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}` },
    }).catch(() => {});
  }

  // Never log an endpoint: it is a capability URL for that device.
  console.info("[cron] push complete", {
    total: rows.length,
    sent,
    failed,
    pruned: expired.length,
  });

  return json({ ok: true, total: rows.length, sent, failed, pruned: expired.length }, 200);
}

/** Constant-time compare so the secret cannot be recovered by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

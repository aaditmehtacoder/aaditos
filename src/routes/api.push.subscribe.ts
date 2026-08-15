import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { serverEnv } from "@/server/env";
import { pushConfigured } from "@/server/push";
import { clearPushSession, writePushSession } from "@/server/push-session";

/**
 * Push subscription registry.
 *
 * GET    reports whether push is available and hands the browser the public key
 *        it needs to subscribe.
 * POST   stores a subscription for the signed-in user.
 * DELETE removes one, so "turn notifications off" actually stops the pushes
 *        rather than just hiding them.
 *
 * The caller's identity comes from their Supabase access token, which is
 * verified against Supabase rather than trusted — a client-supplied user id
 * would let anyone register a subscription against someone else's account.
 */

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(600),
  p256dh: z.string().max(200).optional(),
  auth: z.string().max(200).optional(),
  userAgent: z.string().max(300).optional(),
});

/** Resolves the bearer token to a user id, or null. Never trusts the body. */
async function userFromRequest(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = serverEnv.supabaseUrl;
  const anonKey = serverEnv.supabaseAnonKey;
  if (!token || !url || !anonKey) return null;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { id?: string } | null;
  return data?.id ?? null;
}

/** Service-role write: RLS is bypassed, so the user id above must be verified. */
async function db(path: string, init: RequestInit): Promise<Response> {
  const url = serverEnv.supabaseUrl;
  const key = serverEnv.supabaseServiceRoleKey;
  if (!url || !key) throw new Error("Supabase service role key is not configured.");
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  });
}

export const Route = createFileRoute("/api/push/subscribe")({
  server: {
    handlers: {
      GET: () =>
        json({
          configured: pushConfigured(),
          // Public by design: it is embedded in every subscription anyway.
          publicKey: serverEnv.vapidPublicKey ?? null,
        }),

      POST: async ({ request }) => {
        if (!pushConfigured()) {
          return json(
            {
              ok: false,
              message:
                "Push is not configured. Run node scripts/generate-vapid-keys.mjs and set VAPID_PRIVATE_KEY and VITE_VAPID_PUBLIC_KEY.",
            },
            503,
          );
        }

        const userId = await userFromRequest(request);
        if (!userId) return json({ ok: false, message: "Sign in first." }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, message: "Invalid JSON body." }, 400);
        }

        const parsed = SubscribeSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            { ok: false, message: parsed.error.issues[0]?.message ?? "Bad subscription." },
            422,
          );
        }

        try {
          // Upsert on endpoint: re-subscribing the same device must not stack up
          // rows that would each deliver the same notification.
          const response = await db("push_subscriptions?on_conflict=endpoint", {
            method: "POST",
            headers: { prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({
              user_id: userId,
              endpoint: parsed.data.endpoint,
              p256dh: parsed.data.p256dh ?? null,
              auth: parsed.data.auth ?? null,
              user_agent: parsed.data.userAgent ?? null,
            }),
          });
          if (!response.ok) {
            return json(
              { ok: false, message: `Could not store the subscription (${response.status}).` },
              502,
            );
          }
          // Seal the user id into a cookie so the service worker can identify
          // this user later, when no page is running to supply a token.
          await writePushSession(userId);
          return json({ ok: true });
        } catch (error) {
          return json(
            { ok: false, message: error instanceof Error ? error.message : "Storage failed." },
            503,
          );
        }
      },

      DELETE: async ({ request }) => {
        const userId = await userFromRequest(request);
        if (!userId) return json({ ok: false, message: "Sign in first." }, 401);

        const endpoint = new URL(request.url).searchParams.get("endpoint");
        if (!endpoint) return json({ ok: false, message: "endpoint is required." }, 422);

        try {
          // Scoped by user_id as well as endpoint so a known endpoint cannot be
          // used to delete another account's subscription.
          await db(
            `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${userId}`,
            { method: "DELETE" },
          );
          await clearPushSession();
          return json({ ok: true });
        } catch {
          return json({ ok: false, message: "Could not remove the subscription." }, 503);
        }
      },
    },
  },
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

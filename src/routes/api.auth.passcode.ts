import { createFileRoute } from "@tanstack/react-router";

import {
  accountFor,
  PASSCODE_ACCOUNTS,
  passcodeConfigured,
  passcodeMatches,
  signInWithDerivedPassword,
} from "@/server/passcode";
import { callerKey, checkRateLimit } from "@/server/rate-limit";

/**
 * Passcode sign-in — the door that works on a school Chromebook, where
 * third-party Google OAuth is blocked outright.
 *
 * GET  lists which accounts are reachable, so the sign-in page never has to
 *      hard-code them and can hide the whole panel when unconfigured.
 * POST trades { account, passcode } for a real Supabase session.
 *
 * A three-character passcode is only safe behind a hard rate limit, so this is
 * capped at 5 attempts a minute and 40 a day per caller. The passcode itself is
 * compared in constant time and never logged.
 */
export const Route = createFileRoute("/api/auth/passcode")({
  server: {
    handlers: {
      GET: () =>
        json(
          {
            configured: passcodeConfigured(),
            accounts: PASSCODE_ACCOUNTS.map(({ id, label, email }) => ({ id, label, email })),
          },
          200,
        ),

      POST: async ({ request }) => {
        if (!passcodeConfigured()) {
          return json(
            {
              ok: false,
              message:
                "Passcode sign-in is not configured. Set APP_PASSCODE and ACCOUNT_PASSWORD_SECRET, then run bun run passcode:provision.",
            },
            503,
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, message: "Invalid JSON body" }, 400);
        }

        const { account, passcode } = (body ?? {}) as { account?: unknown; passcode?: unknown };
        if (typeof account !== "string" || typeof passcode !== "string") {
          return json({ ok: false, message: "account and passcode are required" }, 422);
        }

        const limit = checkRateLimit(callerKey(request, "passcode"), {
          windowSec: 60,
          max: 5,
          dailyMax: 40,
        });
        if (!limit.allowed) {
          return json(
            {
              ok: false,
              message:
                limit.reason === "daily"
                  ? "Too many passcode attempts today. Try again tomorrow or use Continue with Google."
                  : `Too many attempts. Wait ${limit.retryAfterSec}s.`,
            },
            429,
            { "retry-after": String(limit.retryAfterSec) },
          );
        }

        const target = accountFor(account);
        if (!target) return json({ ok: false, message: "Unknown account" }, 422);

        if (!(await passcodeMatches(passcode))) {
          return json({ ok: false, message: "That passcode is not right." }, 401);
        }

        try {
          const session = await signInWithDerivedPassword(target.email);
          return json(
            {
              ok: true,
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
              email: session.email,
            },
            200,
          );
        } catch (error) {
          return json(
            { ok: false, message: error instanceof Error ? error.message : "Sign-in failed." },
            502,
          );
        }
      },
    },
  },
});

function json(payload: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // A session must never be cached by a proxy or the browser.
      "cache-control": "no-store",
      ...extra,
    },
  });
}

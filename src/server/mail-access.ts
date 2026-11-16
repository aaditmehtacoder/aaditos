/**
 * The gate in front of every route that opens or answers an email.
 *
 * Two things must both be true: the caller is signed in to this app (a
 * verified Supabase token, not just a cookie a stray tab might carry), and
 * the mailbox they name is one connected in this browser's sealed cookie.
 * Failing either answers with a plain status and a sentence, never a token.
 */

import { bearerToken, verifySupabaseToken } from "./auth";
import { accountsForUser } from "./google-accounts";
import type { GoogleAccount } from "./google-session";
import { GoogleReconnectError } from "./providers/google";
import { checkRateLimit, callerKey } from "./rate-limit";

export type MailAccess =
  { ok: true; userId: string; account: GoogleAccount } | { ok: false; response: Response };

export function json(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function mailAccess(
  request: Request,
  email: string | null | undefined,
  limit: { max: number; dailyMax: number },
): Promise<MailAccess> {
  const token = bearerToken(request);
  const userId = token ? await verifySupabaseToken(token) : null;
  if (!userId) {
    return { ok: false, response: json({ ok: false, message: "Sign in again." }, 401) };
  }
  const rate = checkRateLimit(`mail:${callerKey(request, userId)}`, { windowSec: 60, ...limit });
  if (!rate.allowed) {
    return {
      ok: false,
      response: json(
        { ok: false, message: `Too many requests. Try again in ${rate.retryAfterSec}s.` },
        429,
        { "retry-after": String(rate.retryAfterSec) },
      ),
    };
  }
  const key = (email ?? "").trim().toLowerCase();
  const account = (await accountsForUser(userId)).find((a) => a.email?.toLowerCase() === key);
  if (!key || !account) {
    return {
      ok: false,
      response: json({ ok: false, message: "That account is not connected here." }, 404),
    };
  }
  return { ok: true, userId, account };
}

/**
 * A Gmail call that failed, as an answer the page can act on.
 *
 * Never 502 or 504: the site is served through Cloudflare, which replaces
 * those with its own HTML page, so the sentence never reached the person and
 * an expired inbox showed only "Request failed (502)". An expired or revoked
 * connection says so with `code: "reconnect"`, so the page can offer it.
 */
export function mailFailure(error: unknown, fallback: string): Response {
  if (error instanceof GoogleReconnectError) {
    return json(
      { ok: false, code: "reconnect", message: "Google sign-in expired. Reconnect this inbox." },
      401,
    );
  }
  return json({ ok: false, message: error instanceof Error ? error.message : fallback }, 503);
}

/** Gmail message ids are short hex strings; the app's own ids carry a "gmail:" prefix. */
export function gmailId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.replace(/^gmail:/, "");
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}

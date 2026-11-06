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

/** Gmail message ids are short hex strings; the app's own ids carry a "gmail:" prefix. */
export function gmailId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.replace(/^gmail:/, "");
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}

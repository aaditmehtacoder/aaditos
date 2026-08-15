/**
 * Passcode sign-in.
 *
 * Why this exists: a school-managed Chromebook blocks third-party Google OAuth,
 * so "Continue with Google" simply cannot complete there. This gives the same
 * accounts a second door — one short passcode, typed on any device, no Google
 * round-trip.
 *
 * The passcode the user types is never the Supabase password. Supabase rejects
 * anything under six characters, and a three-letter password would be weak
 * regardless. Instead the server:
 *
 *   1. compares the typed passcode against `APP_PASSCODE` in constant time,
 *   2. derives that account's real, long password from `ACCOUNT_PASSWORD_SECRET`
 *      plus the email, and
 *   3. exchanges it with Supabase for a normal session.
 *
 * So the browser only ever sees a passcode and a session — never the real
 * password, and never the derivation secret. The accounts are the same rows
 * Google sign-in creates, so all existing data and RLS policies still apply.
 */

import { serverEnv } from "./env";

/**
 * The accounts reachable by passcode.
 *
 * One, deliberately. Three accounts meant a picker on the sign-in screen and a
 * decision to make before typing anything — and it split the same person's work
 * across three separate workspaces, so a task added on one was invisible on the
 * others. One main account keeps everything in one place.
 *
 * Adding an entry here brings the picker back automatically; the sign-in page
 * renders it only when there is more than one.
 */
export const PASSCODE_ACCOUNTS = [
  { id: "main", email: "aaditmehtacoder@gmail.com", label: "aaditmehtacoder" },
] as const;

export type PasscodeAccountId = (typeof PASSCODE_ACCOUNTS)[number]["id"];

export function accountFor(id: string): (typeof PASSCODE_ACCOUNTS)[number] | undefined {
  return PASSCODE_ACCOUNTS.find((a) => a.id === id);
}

export function passcodeConfigured(): boolean {
  return Boolean(serverEnv.appPasscode && serverEnv.accountPasswordSecret && serverEnv.supabaseUrl);
}

/**
 * Length-independent comparison. A plain `===` on strings leaks length and
 * position through timing; with a three-character passcode that is a real
 * shortcut, so both sides are hashed to a fixed 32 bytes first.
 */
export async function passcodeMatches(typed: string): Promise<boolean> {
  const expected = serverEnv.appPasscode;
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(typed.trim()), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * The account's actual Supabase password: HMAC(secret, email), hex-encoded.
 * Deterministic, so it never needs storing — but unguessable without the
 * secret, and rotating the secret invalidates every derived password at once.
 */
export async function derivePassword(email: string): Promise<string> {
  const secret = serverEnv.accountPasswordSecret;
  if (!secret) throw new Error("ACCOUNT_PASSWORD_SECRET is not set.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`aaditos:account:${email.toLowerCase()}`),
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

export interface PasscodeSession {
  accessToken: string;
  refreshToken: string;
  email: string;
}

/** Exchanges the derived password for a Supabase session. */
export async function signInWithDerivedPassword(email: string): Promise<PasscodeSession> {
  const url = serverEnv.supabaseUrl;
  const anonKey = serverEnv.supabaseAnonKey;
  if (!url || !anonKey) throw new Error("Supabase is not configured on the server.");

  const password = await derivePassword(email);
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(12_000),
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
    msg?: string;
    error?: string;
  };

  if (!response.ok || !data.access_token || !data.refresh_token) {
    // "Invalid login credentials" here almost always means the password has not
    // been provisioned for this account yet — say so instead of implying the
    // user typed the passcode wrong.
    const detail = data.error_description ?? data.msg ?? data.error ?? `HTTP ${response.status}`;
    throw new Error(
      /invalid login credentials/i.test(detail)
        ? `${email} has no passcode password yet. Run "bun run passcode:provision".`
        : detail,
    );
  }

  return { accessToken: data.access_token, refreshToken: data.refresh_token, email };
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

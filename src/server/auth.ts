/**
 * Who is calling.
 *
 * The AI endpoints used to treat every caller the same and protect the key
 * with a daily cap, which meant the owner shared a ceiling built for
 * strangers. Now the browser sends its Supabase access token, the server
 * verifies it, and a verified owner gets the owner's limits (none, by
 * default) while an anonymous caller keeps the small guest cap.
 *
 * Verification is one GET to Supabase's `/auth/v1/user`, cached by token for
 * a few minutes so a chat with ten tool rounds does not make ten identity
 * checks. Nothing from the token is logged.
 */

import { serverEnv } from "./env";

export interface Caller {
  kind: "owner" | "guest";
  /** Supabase user id for an owner; the client's random id otherwise. */
  id: string;
}

interface CacheEntry {
  userId: string;
  until: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  // JWTs are three dot-separated base64url segments. Anything else is noise.
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
}

/** Verifies a Supabase access token. Returns the user id, or null. */
export async function verifySupabaseToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = serverEnv.supabaseUrl;
  const anonKey = serverEnv.supabaseAnonKey;
  if (!url || !anonKey) return null;

  const cached = cache.get(token);
  if (cached && cached.until > Date.now()) return cached.userId;

  try {
    const response = await fetchImpl(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { id?: string };
    if (!data.id) return null;
    if (cache.size > MAX_ENTRIES) cache.clear();
    cache.set(token, { userId: data.id, until: Date.now() + TTL_MS });
    return data.id;
  } catch {
    // Supabase unreachable: fail closed to guest, never to owner.
    return null;
  }
}

/** Resolves the caller from the request's bearer token, falling back to guest. */
export async function identifyCaller(request: Request, clientId: string): Promise<Caller> {
  const token = bearerToken(request);
  if (token) {
    const userId = await verifySupabaseToken(token);
    if (userId) return { kind: "owner", id: userId };
  }
  return { kind: "guest", id: clientId };
}

/** The limits a caller gets. Owner: effectively none. Guest: small and daily. */
export function limitsFor(caller: Caller): { windowSec: number; max: number; dailyMax: number } {
  if (caller.kind === "owner") {
    // 120 a minute is not a limit a person can reach by typing; it only exists
    // so a client-side loop cannot hammer the provider unattended.
    return { windowSec: 60, max: 120, dailyMax: serverEnv.openaiDailyRequestCap };
  }
  return { windowSec: 60, max: 8, dailyMax: serverEnv.openaiGuestDailyCap };
}

/** Testing hook. */
export function resetCallerCache(): void {
  cache.clear();
}

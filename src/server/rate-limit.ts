/**
 * In-memory sliding-window rate limiter.
 *
 * Per-instance on purpose: a distributed limiter would need Redis, and this is
 * a one-person app. Its job is narrow — keep a stranger who finds the endpoint
 * from spending the OpenAI key, and stop a client-side bug from looping. The
 * signed-in owner is never meant to hit it: `dailyMax: 0` means unlimited,
 * and the per-minute window for an authenticated caller is set far above what
 * a person typing can produce.
 */

interface Bucket {
  hits: number[];
  day: string;
  dayCount: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  reason?: "window" | "daily";
  /** Remaining today. `Infinity` when there is no daily cap. */
  remaining: number;
}

export interface RateLimitOptions {
  windowSec: number;
  /** Max hits inside the window. `0` disables the window check. */
  max: number;
  /** Max hits per UTC day. `0` disables the daily check. */
  dailyMax: number;
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);

  if (buckets.size > MAX_BUCKETS) buckets.clear();

  let bucket = buckets.get(key);
  if (!bucket || bucket.day !== day) {
    bucket = { hits: [], day, dayCount: 0 };
    buckets.set(key, bucket);
  }

  const windowStart = now - opts.windowSec * 1000;
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  const dailyLimited = opts.dailyMax > 0;
  if (dailyLimited && bucket.dayCount >= opts.dailyMax) {
    return { allowed: false, retryAfterSec: 3600, reason: "daily", remaining: 0 };
  }
  if (opts.max > 0 && bucket.hits.length >= opts.max) {
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + opts.windowSec * 1000 - now) / 1000)),
      reason: "window",
      remaining: dailyLimited ? Math.max(0, opts.dailyMax - bucket.dayCount) : Infinity,
    };
  }

  bucket.hits.push(now);
  bucket.dayCount += 1;
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: dailyLimited ? Math.max(0, opts.dailyMax - bucket.dayCount) : Infinity,
  };
}

/** Stable per-caller key that never contains personal data. */
export function callerKey(request: Request, clientId: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${ip}:${clientId.slice(0, 24)}`;
}

/** Testing hook. */
export function resetRateLimits(): void {
  buckets.clear();
}

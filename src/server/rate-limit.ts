/**
 * In-memory sliding-window rate limiter.
 *
 * Good enough for a single-person app on one serverless region: it protects the
 * OpenAI key from a runaway client or a bored stranger who finds the endpoint.
 * It is intentionally per-instance — a distributed limiter would need Redis,
 * and the daily cap below is the real spending guard.
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
  remaining: number;
}

export function checkRateLimit(
  key: string,
  opts: { windowSec: number; max: number; dailyMax: number },
): RateLimitResult {
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

  if (bucket.dayCount >= opts.dailyMax) {
    return { allowed: false, retryAfterSec: 3600, reason: "daily", remaining: 0 };
  }
  if (bucket.hits.length >= opts.max) {
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + opts.windowSec * 1000 - now) / 1000)),
      reason: "window",
      remaining: 0,
    };
  }

  bucket.hits.push(now);
  bucket.dayCount += 1;
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: Math.max(0, opts.dailyMax - bucket.dayCount),
  };
}

/** Stable per-caller key that never contains personal data. */
export function callerKey(request: Request, clientId: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${ip}:${clientId.slice(0, 24)}`;
}

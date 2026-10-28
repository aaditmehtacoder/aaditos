/**
 * Keeps the assistant answering.
 *
 * One key and one model is one point of failure: a rate limit, a quota that
 * ran out, or a model having a bad hour all look identical from the sign-in
 * page — "the assistant does not work". This module is the difference.
 *
 * Every call runs through `withFallback`, which walks a ladder:
 *
 *   key 1 × model 1  →  key 1 × model 2  →  …  →  key 2 × model 1  →  …
 *
 * and moves one rung down whenever the failure is the *provider's* problem
 * (429 rate limit, 429 insufficient quota, 5xx, overloaded, timeout, network)
 * rather than the request's (400 bad input, 401 bad key, 404 bad model —
 * though a 404 or model-level 400 also moves to the next model, since that
 * key may simply not have it). A short backoff separates attempts on the
 * same rung, and a small gate caps how many calls run at once so a burst of
 * captures cannot trip the provider's per-minute limit on its own.
 *
 * The SDK's own retries are turned off here so this ladder is the only retry
 * policy; two overlapping policies produce long unexplained waits.
 */

import OpenAI from "openai";

import { serverEnv } from "./env";

export interface Rung {
  key: string;
  keyIndex: number;
  model: string;
}

export interface Attempt<T> {
  (client: OpenAI, rung: Rung): Promise<T>;
}

export interface FallbackResult<T> {
  value: T;
  rung: Rung;
  /** Rungs tried before the one that answered. Empty on the first try. */
  skipped: Array<{ rung: Rung; reason: string }>;
}

export class NoKeyError extends Error {
  code = "missing_key" as const;
  constructor() {
    super("OPENAI_API_KEY is not configured on the server.");
  }
}

export class ExhaustedError extends Error {
  code = "exhausted" as const;
  constructor(
    public readonly attempts: Array<{ rung: Rung; reason: string }>,
    public readonly last: unknown,
  ) {
    super(
      `Every model and key was tried (${attempts.length} attempt${attempts.length === 1 ? "" : "s"}). ` +
        `Last error: ${attempts[attempts.length - 1]?.reason ?? "unknown"}`,
    );
  }
}

/** The rungs in order. Keys outer, models inner. */
export function ladder(): Rung[] {
  const keys = serverEnv.openaiApiKeys;
  const models = serverEnv.openaiModels;
  const out: Rung[] = [];
  keys.forEach((key, keyIndex) => {
    for (const model of models) out.push({ key, keyIndex, model });
  });
  return out;
}

const clients = new Map<string, OpenAI>();

function clientFor(key: string): OpenAI {
  let client = clients.get(key);
  if (!client) {
    client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 90_000 });
    clients.set(key, client);
  }
  return client;
}

/**
 * Whether a failure is worth moving down the ladder for, and a short reason.
 * Returns `null` for failures that are the caller's fault, which no fallback
 * would fix.
 */
export function classify(error: unknown): {
  retryable: boolean;
  reason: string;
  /** True when waiting on the same rung cannot help: the request itself is over that model's ceiling. */
  immediate?: boolean;
} {
  if (error instanceof OpenAI.APIError) {
    // A failure mid-stream arrives with no status; the body's code still says what it was.
    const code = String((error as { code?: unknown }).code ?? "");
    const message = error.message || `HTTP ${error.status ?? 0}`;
    const status =
      error.status ??
      (/rate_limit|insufficient_quota/.test(code) ? 429 : /server_error/.test(code) ? 500 : 0);
    if (status === 429) {
      if (/request too large/i.test(message)) {
        // Over this model's tokens-per-minute ceiling outright. No backoff
        // will make it fit; the next model has a different ceiling.
        return { retryable: true, immediate: true, reason: `too large for model (${status})` };
      }
      return {
        retryable: true,
        reason: /quota|billing/i.test(`${code} ${message}`)
          ? `quota exhausted (${status})`
          : `rate limited (${status})`,
      };
    }
    if (status >= 500 || status === 408) return { retryable: true, reason: `server ${status}` };
    if (status === 401 || status === 403)
      return { retryable: true, reason: `key rejected (${status})` };
    if (status === 404 || (status === 400 && /model/i.test(message))) {
      return { retryable: true, reason: `model unavailable (${status})` };
    }
    if (status === 400 && /overloaded|capacity/i.test(message)) {
      return { retryable: true, reason: "overloaded" };
    }
    return { retryable: false, reason: message };
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return { retryable: false, reason: "cancelled" };
    if (/timeout|timed out|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(error.message)) {
      return { retryable: true, reason: `network: ${error.message}` };
    }
    return { retryable: false, reason: error.message };
  }
  return { retryable: true, reason: "unknown failure" };
}

// ---- concurrency gate -----------------------------------------------------

const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<() => void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
  } else {
    await new Promise<void>((resolve) => waiting.push(resolve));
    inFlight += 1;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
    waiting.shift()?.();
  };
}

/** For tests and the status endpoint. */
export function gateState(): { inFlight: number; waiting: number; max: number } {
  return { inFlight, waiting: waiting.length, max: MAX_IN_FLIGHT };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(Object.assign(new Error("Request cancelled."), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

export interface FallbackOptions {
  signal?: AbortSignal | undefined;
  /** Retries on the same rung for transient failures before stepping down. Default 1. */
  sameRungRetries?: number;
  /** Base delay between attempts in ms. Default 400. Grows ×2 per attempt, capped at 4s. */
  baseDelayMs?: number;
  /** Override the ladder — used by tests. */
  rungs?: Rung[];
}

/**
 * Run `attempt` against each rung until one succeeds.
 *
 * Within a rung, a transient failure is retried once with a short backoff —
 * most 429s clear in under a second, and switching models for a hiccup would
 * change the answer's voice for no reason. After that the next rung is tried.
 */
export async function withFallback<T>(
  attempt: Attempt<T>,
  opts: FallbackOptions = {},
): Promise<FallbackResult<T>> {
  const rungs = opts.rungs ?? ladder();
  if (rungs.length === 0) throw new NoKeyError();

  const sameRungRetries = opts.sameRungRetries ?? 1;
  const base = opts.baseDelayMs ?? 400;
  const skipped: Array<{ rung: Rung; reason: string }> = [];
  let last: unknown;
  let attemptNo = 0;

  const release = await acquire();
  const deadKeys = new Set<number>();
  try {
    for (const rung of rungs) {
      // A rejected key will not start working on its next model.
      if (deadKeys.has(rung.keyIndex)) continue;
      for (let retry = 0; retry <= sameRungRetries; retry += 1) {
        if (opts.signal?.aborted) {
          throw Object.assign(new Error("Request cancelled."), { name: "AbortError" });
        }
        if (attemptNo > 0) await sleep(Math.min(4000, base * 2 ** (attemptNo - 1)), opts.signal);
        attemptNo += 1;
        try {
          const value = await attempt(clientFor(rung.key), rung);
          return { value, rung, skipped };
        } catch (error) {
          last = error;
          const { retryable, reason, immediate } = classify(error);
          if (!retryable) throw error;
          // Only the last failure on a rung is recorded as the reason it was skipped.
          if (/key rejected/.test(reason)) {
            deadKeys.add(rung.keyIndex);
            skipped.push({ rung, reason });
            break;
          }
          if (retry === sameRungRetries || immediate) skipped.push({ rung, reason });
          if (immediate) break;
        }
      }
    }
  } finally {
    release();
  }
  throw new ExhaustedError(skipped, last);
}

/** Public, token-free description of the ladder for the Settings page. */
export function describeLadder(): { keys: number; models: string[] } {
  return { keys: serverEnv.openaiApiKeys.length, models: serverEnv.openaiModels };
}

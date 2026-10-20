// @vitest-environment node
/**
 * "Never runs out, never rate limits."
 *
 * Two mechanisms carry that promise, and both are pinned here:
 *   - the ladder: a 429 or 5xx on one key × model moves to the next rung,
 *     and a request-side error (400) does not;
 *   - the limits: a verified owner has no daily cap, a guest has a small one.
 */

import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExhaustedError, NoKeyError, classify, ladder, withFallback, type Rung } from "@/server/ai";
import { limitsFor } from "@/server/auth";
import { checkRateLimit, resetRateLimits } from "@/server/rate-limit";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env["OPENAI_API_KEY"] = "sk-primary";
  process.env["OPENAI_API_KEY_FALLBACK"] = "sk-spare";
  process.env["OPENAI_MODEL"] = "gpt-5.6-terra";
  process.env["OPENAI_FALLBACK_MODELS"] = "gpt-5.6-luna";
  delete process.env["OPENAI_DAILY_REQUEST_CAP"];
  resetRateLimits();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function apiError(status: number, message = "boom", code?: string): Error {
  return new OpenAI.APIError(status, { error: { message, code } }, message, new Headers());
}

const rungs: Rung[] = [
  { key: "k1", keyIndex: 0, model: "m1" },
  { key: "k1", keyIndex: 0, model: "m2" },
  { key: "k2", keyIndex: 1, model: "m1" },
];

describe("ladder", () => {
  it("is keys outer, models inner, primary first", () => {
    expect(ladder().map((r) => `${r.keyIndex}:${r.model}`)).toEqual([
      "0:gpt-5.6-terra",
      "0:gpt-5.6-luna",
      "1:gpt-5.6-terra",
      "1:gpt-5.6-luna",
    ]);
  });

  it("is empty without a key, and withFallback says so", async () => {
    delete process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY_FALLBACK"];
    expect(ladder()).toEqual([]);
    await expect(withFallback(async () => 1)).rejects.toBeInstanceOf(NoKeyError);
  });
});

describe("classify", () => {
  it("retries rate limits, quota, server errors and model-not-found", () => {
    expect(classify(apiError(429, "Rate limit reached")).retryable).toBe(true);
    expect(
      classify(apiError(429, "You exceeded your current quota", "insufficient_quota")).reason,
    ).toMatch(/quota/);
    expect(classify(apiError(503)).retryable).toBe(true);
    expect(classify(apiError(404, "The model `x` does not exist")).retryable).toBe(true);
    expect(classify(apiError(400, "Unsupported model")).retryable).toBe(true);
  });

  it("does not retry the caller's own mistakes", () => {
    expect(classify(apiError(400, "Invalid schema for response_format")).retryable).toBe(false);
    expect(classify(Object.assign(new Error("x"), { name: "AbortError" })).retryable).toBe(false);
  });
});

describe("withFallback", () => {
  it("answers on the first rung when it works", async () => {
    const attempt = vi.fn(async () => "ok");
    const result = await withFallback(attempt, { rungs, baseDelayMs: 1 });
    expect(result.value).toBe("ok");
    expect(result.rung).toEqual(rungs[0]);
    expect(result.skipped).toEqual([]);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("moves down the ladder on a rate limit and reports what it skipped", async () => {
    const attempt = vi.fn(async (_c: OpenAI, rung: Rung) => {
      if (rung.model === "m1" && rung.keyIndex === 0) throw apiError(429, "Rate limit reached");
      return `answered by ${rung.keyIndex}:${rung.model}`;
    });
    const result = await withFallback(attempt, { rungs, baseDelayMs: 1, sameRungRetries: 1 });
    expect(result.value).toBe("answered by 0:m2");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toMatch(/rate limited/);
    // One retry on the same rung before stepping down.
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("switches keys when the primary is out of quota", async () => {
    const attempt = vi.fn(async (_c: OpenAI, rung: Rung) => {
      if (rung.keyIndex === 0) throw apiError(429, "insufficient_quota", "insufficient_quota");
      return "spare key answered";
    });
    const result = await withFallback(attempt, { rungs, baseDelayMs: 1, sameRungRetries: 0 });
    expect(result.value).toBe("spare key answered");
    expect(result.rung.keyIndex).toBe(1);
  });

  it("gives up with every attempt listed only when everything failed", async () => {
    const attempt = vi.fn(async () => {
      throw apiError(503, "overloaded");
    });
    await expect(
      withFallback(attempt, { rungs, baseDelayMs: 1, sameRungRetries: 0 }),
    ).rejects.toBeInstanceOf(ExhaustedError);
    expect(attempt).toHaveBeenCalledTimes(rungs.length);
  });

  it("does not hide a bad request behind the ladder", async () => {
    const attempt = vi.fn(async () => {
      throw apiError(400, "Invalid schema");
    });
    await expect(withFallback(attempt, { rungs, baseDelayMs: 1 })).rejects.toThrow(
      /Invalid schema/,
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("limits", () => {
  it("gives the owner no daily cap by default", () => {
    const owner = limitsFor({ kind: "owner", id: "u1" });
    expect(owner.dailyMax).toBe(0);
    for (let i = 0; i < 500; i += 1) {
      const r = checkRateLimit("owner", { ...owner, max: 0 });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(Infinity);
    }
  });

  it("still honours an explicit daily stop if one is configured", () => {
    process.env["OPENAI_DAILY_REQUEST_CAP"] = "3";
    const owner = limitsFor({ kind: "owner", id: "u1" });
    expect(owner.dailyMax).toBe(3);
    checkRateLimit("o", owner);
    checkRateLimit("o", owner);
    checkRateLimit("o", owner);
    expect(checkRateLimit("o", owner)).toMatchObject({ allowed: false, reason: "daily" });
  });

  it("caps a guest", () => {
    const guest = limitsFor({ kind: "guest", id: "anon" });
    expect(guest.dailyMax).toBeGreaterThan(0);
    expect(guest.dailyMax).toBeLessThan(limitsFor({ kind: "owner", id: "u1" }).max);
  });
});

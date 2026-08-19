import { createFileRoute } from "@tanstack/react-router";

import { captureItems } from "@/server/compass-runtime";
import { callerKey, checkRateLimit } from "@/server/rate-limit";
import { serverEnv } from "@/server/env";
import { CaptureRequestSchema, CapturedItemSchema } from "@/server/schemas";

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * Capture: any text in, filed items out.
 *
 * The model's output is re-validated against `CapturedItemSchema` here rather
 * than trusted, and anything that fails is dropped instead of failing the whole
 * request — one malformed item out of five should still leave you with four.
 *
 * Dropped items are counted and logged rather than swallowed. That is not
 * diligence for its own sake: a mismatch between this schema and what the model
 * returns once deleted every note the box produced, and the only symptom was an
 * empty result with nothing to explain it.
 */
export const Route = createFileRoute("/api/capture")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, code: "bad_request", message: "Invalid JSON body." }, 400);
        }

        const parsed = CaptureRequestSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            {
              ok: false,
              code: "invalid_input",
              message: parsed.error.issues[0]?.message ?? "Request did not match the schema.",
            },
            422,
          );
        }

        if (!serverEnv.openaiApiKey) {
          return json(
            {
              ok: false,
              code: "missing_key",
              message: "Capture needs OPENAI_API_KEY on the server.",
            },
            503,
          );
        }

        const limit = checkRateLimit(callerKey(request, parsed.data.clientId), {
          windowSec: 60,
          max: 12,
          dailyMax: serverEnv.openaiDailyRequestCap,
        });
        if (!limit.allowed) {
          return json(
            {
              ok: false,
              code: "rate_limited",
              message: `Too many requests. Try again in ${limit.retryAfterSec}s.`,
            },
            429,
            { "retry-after": String(limit.retryAfterSec) },
          );
        }

        const result = await captureItems(parsed.data.text, {
          now: new Date().toISOString(),
          timezone: parsed.data.timezone,
          courses: parsed.data.courses,
          teachers: parsed.data.teachers,
          clientId: parsed.data.clientId,
        });

        if (!result.ok) return json(result, 502);

        const parsedItems = (result.items ?? []).map((raw) => CapturedItemSchema.safeParse(raw));
        const items = parsedItems
          .filter((r) => r.success)
          .map((r) => r.data)
          .slice(0, 20);
        const dropped = parsedItems.length - items.length;

        if (dropped > 0) {
          console.warn("[capture] items failed validation and were dropped", {
            dropped,
            kept: items.length,
            firstIssue: parsedItems.find((r) => !r.success)?.error.issues[0]?.message,
          });
        }

        return json(
          {
            ok: true,
            items,
            ...(dropped > 0 ? { dropped } : {}),
            ...(result.note ? { note: result.note } : {}),
            remainingToday: limit.remaining,
          },
          200,
          { "x-ratelimit-remaining": String(limit.remaining) },
        );
      },
    },
  },
});

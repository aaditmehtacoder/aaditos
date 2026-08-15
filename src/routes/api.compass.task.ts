import { createFileRoute } from "@tanstack/react-router";

import { TaskDraftSchema } from "@/lib/core/nl-task";
import { proposeTaskStructured } from "@/server/compass-runtime";
import { callerKey, checkRateLimit } from "@/server/rate-limit";
import { serverEnv } from "@/server/env";
import { CompassTaskRequestSchema } from "@/server/schemas";

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** Structured Outputs endpoint: text in, one strict-schema `TaskDraft` out. */
export const Route = createFileRoute("/api/compass/task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, code: "bad_request", message: "Invalid JSON body." }, 400);
        }

        const parsed = CompassTaskRequestSchema.safeParse(body);
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
              message: "Compass is not configured. Add OPENAI_API_KEY to enable AI drafting.",
            },
            503,
          );
        }

        const limit = checkRateLimit(callerKey(request, parsed.data.clientId), {
          windowSec: 60,
          max: 10,
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

        const result = await proposeTaskStructured(parsed.data.text, {
          courses: parsed.data.courses,
          projects: parsed.data.projects,
          now: new Date().toISOString(),
          timezone: parsed.data.timezone,
          clientId: parsed.data.clientId,
        });

        if (!result.ok) return json(result, 502);

        // Re-validate the model's output before it reaches the UI.
        const raw = result.draft as Record<string, unknown>;
        const cleaned = Object.fromEntries(
          Object.entries(raw).filter(
            ([, v]) => v !== null && !(Array.isArray(v) && v.length === 0),
          ),
        );
        const draft = TaskDraftSchema.safeParse(cleaned);
        if (!draft.success) {
          return json(
            {
              ok: false,
              code: "invalid_draft",
              message: "Compass returned a draft that did not match the task schema.",
            },
            502,
          );
        }
        // Tell the client how much of today's budget is left. A limit you can
        // see coming is a different experience from one you hit face-first.
        return json({ ok: true, draft: draft.data, remainingToday: limit.remaining }, 200, {
          "x-ratelimit-remaining": String(limit.remaining),
        });
      },
    },
  },
});

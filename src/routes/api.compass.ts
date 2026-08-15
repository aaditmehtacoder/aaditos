import { createFileRoute } from "@tanstack/react-router";

import type { CompassEvent } from "@/lib/compass/types";
import { runCompassTurn } from "@/server/compass-runtime";
import { callerKey, checkRateLimit } from "@/server/rate-limit";
import { serverEnv } from "@/server/env";
import { CompassRequestSchema } from "@/server/schemas";

function line(event: CompassEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function errorResponse(event: CompassEvent, status: number, headers: Record<string, string> = {}) {
  return new Response(`${JSON.stringify(event)}\n`, {
    status,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", ...headers },
  });
}

export const Route = createFileRoute("/api/compass")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse(
            { type: "error", code: "bad_request", message: "Invalid JSON body.", retryable: false },
            400,
          );
        }

        const parsed = CompassRequestSchema.safeParse(body);
        if (!parsed.success) {
          return errorResponse(
            {
              type: "error",
              code: "invalid_input",
              message: parsed.error.issues[0]?.message ?? "Request did not match the schema.",
              retryable: false,
            },
            422,
          );
        }

        if (!serverEnv.openaiApiKey) {
          return errorResponse(
            {
              type: "error",
              code: "missing_key",
              message: "OPENAI_API_KEY is not set on the server.",
              retryable: false,
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
          return errorResponse(
            {
              type: "error",
              code: limit.reason === "daily" ? "daily_cap" : "rate_limited",
              message:
                limit.reason === "daily"
                  ? "Daily Compass request limit reached. It resets at midnight UTC."
                  : `Too many requests. Try again in ${limit.retryAfterSec}s.`,
              retryable: true,
            },
            429,
            { "retry-after": String(limit.retryAfterSec) },
          );
        }

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const event of runCompassTurn({
                messages: parsed.data.messages,
                snapshot: parsed.data.snapshot as never,
                tone: parsed.data.tone,
                clientId: parsed.data.clientId,
                signal: request.signal,
              })) {
                controller.enqueue(line(event));
              }
            } catch (error) {
              // Structured server log — no prompt content, no key material.
              console.error("[compass] stream failed", {
                message: error instanceof Error ? error.message : "unknown",
              });
              controller.enqueue(
                line({
                  type: "error",
                  code: "stream_failed",
                  message: "The response stream ended unexpectedly.",
                  retryable: true,
                }),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});

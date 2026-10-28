import { createFileRoute } from "@tanstack/react-router";

import type { CompassEvent } from "@/lib/compass/types";
import { identifyCaller, limitsFor } from "@/server/auth";
import { runCompassTurn } from "@/server/compass-runtime";
import { callerKey, checkRateLimit } from "@/server/rate-limit";
import { serverEnv } from "@/server/env";
import { CompassRequestSchema, attachmentUrlAllowed } from "@/server/schemas";

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

        // Every file link must point at this app's own private bucket. The
        // schema checked the shape; only here is the host known.
        const badFile = parsed.data.messages
          .flatMap((m) => m.attachments ?? [])
          .find((a) => !attachmentUrlAllowed(a.url, serverEnv.supabaseUrl));
        if (badFile) {
          return errorResponse(
            {
              type: "error",
              code: "invalid_input",
              message: `"${badFile.name}" is not stored where this app keeps files. Attach it again.`,
              retryable: false,
            },
            422,
          );
        }

        if (serverEnv.openaiApiKeys.length === 0) {
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

        // The owner is never capped; a guest (a stranger who found the
        // endpoint) gets a small daily allowance that protects the key.
        const caller = await identifyCaller(request, parsed.data.clientId);
        const limit = checkRateLimit(
          callerKey(request, caller.kind === "owner" ? `owner:${caller.id}` : caller.id),
          limitsFor(caller),
        );
        if (!limit.allowed) {
          return errorResponse(
            {
              type: "error",
              code: limit.reason === "daily" ? "daily_cap" : "rate_limited",
              message:
                limit.reason === "daily"
                  ? caller.kind === "guest"
                    ? "Sign in to keep asking."
                    : "The daily request stop you configured was reached."
                  : `Too many requests at once. Try again in ${limit.retryAfterSec}s.`,
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
                clientId: parsed.data.clientId,
                signal: request.signal,
                // A picture is the one thing here that costs real money per
                // call, so only the verified owner gets the painter.
                allowImages: caller.kind === "owner",
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

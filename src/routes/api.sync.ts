import { createFileRoute } from "@tanstack/react-router";

import { runSync } from "@/server/sync";
import { SyncRequestSchema } from "@/server/schemas";
import { callerKey, checkRateLimit } from "@/server/rate-limit";

/**
 * Fan-out sync. Returns normalized data for the client to persist through the
 * repository; a failure in one provider never fails the request.
 */
export const Route = createFileRoute("/api/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = SyncRequestSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            { error: parsed.error.issues[0]?.message ?? "Request did not match the schema" },
            422,
          );
        }

        const limit = checkRateLimit(callerKey(request, parsed.data.userId), {
          windowSec: 60,
          max: 10,
          dailyMax: 500,
        });
        if (!limit.allowed) {
          return json(
            { error: `Too many sync requests. Try again in ${limit.retryAfterSec}s.` },
            429,
            { "retry-after": String(limit.retryAfterSec) },
          );
        }

        const payload = await runSync({
          providers: parsed.data.providers,
          userId: parsed.data.userId,
        });
        return json(payload, 200, { "cache-control": "no-store" });
      },
    },
  },
});

function json(payload: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

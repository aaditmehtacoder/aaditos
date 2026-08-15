import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { readGoogleSession } from "@/server/google-session";
import { createCalendarEvent } from "@/server/providers/google";
import { callerKey, checkRateLimit } from "@/server/rate-limit";

/**
 * The one write in AaditOS: adding an event to Google Calendar.
 *
 * It exists so a confirmed item actually changes the calendar the user already
 * lives in, rather than only appearing inside this app. It is reachable only by
 * an explicit POST from a confirmation the user clicked — no sync path, no cron
 * job, and no Compass tool calls it.
 *
 * Rate-limited because a loop bug here would litter a real calendar.
 */

const CreateEventSchema = z.object({
  title: z.string().min(1).max(250),
  description: z.string().max(4000).optional(),
  location: z.string().max(250).optional(),
  startAt: z.string().min(4).max(40),
  endAt: z.string().max(40).optional(),
  allDay: z.boolean().default(false),
  timezone: z.string().max(64).default("America/Los_Angeles"),
  clientId: z.string().min(8).max(64),
});

export const Route = createFileRoute("/api/google/calendar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, code: "bad_request", message: "Invalid JSON body." }, 400);
        }

        const parsed = CreateEventSchema.safeParse(body);
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
        const input = parsed.data;

        const limit = checkRateLimit(callerKey(request, `calendar:${input.clientId}`), {
          windowSec: 60,
          max: 12,
          dailyMax: 120,
        });
        if (!limit.allowed) {
          return json(
            {
              ok: false,
              code: "rate_limited",
              message: `Too many calendar writes. Try again in ${limit.retryAfterSec}s.`,
            },
            429,
            { "retry-after": String(limit.retryAfterSec) },
          );
        }

        const session = await readGoogleSession();
        if (!session.refreshToken) {
          return json(
            {
              ok: false,
              code: "not_connected",
              message: "Google is not connected. Use Connect on the Integrations page first.",
            },
            409,
          );
        }

        const result = await createCalendarEvent(session.refreshToken, {
          title: input.title,
          description: input.description,
          location: input.location,
          startAt: input.startAt,
          endAt: input.endAt,
          allDay: input.allDay,
          timezone: input.timezone,
        });

        return json(result, result.ok ? 200 : result.code === "not_configured" ? 503 : 502);
      },
    },
  },
});

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

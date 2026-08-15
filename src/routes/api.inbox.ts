import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { extractItemsFromEmail } from "@/server/compass-runtime";
import { serverEnv } from "@/server/env";
import { readGoogleSession } from "@/server/google-session";
import { DEFAULT_QUERY, fetchGmail } from "@/server/providers/gmail";
import { callerKey, checkRateLimit } from "@/server/rate-limit";

/**
 * Inbox ingestion.
 *
 * GET  reads messages matching a narrow Gmail query — never the whole mailbox.
 * POST turns one message (or pasted text) into dated tasks and events.
 *
 * The POST path accepts pasted text on purpose: on a school Chromebook the
 * Gmail API may be blocked by the Workspace admin, and pasting the email still
 * has to work. Same extractor, same schema, either way in.
 */

const ExtractSchema = z.object({
  /** Either an id from GET, or the raw text of an email pasted by hand. */
  messageId: z.string().max(120).optional(),
  text: z.string().max(20_000).optional(),
  subject: z.string().max(500).optional(),
  from: z.string().max(300).optional(),
  /** Anchors relative wording like "this Wednesday". Defaults to now. */
  receivedAt: z.string().max(40).optional(),
  timezone: z.string().max(64).default("America/Los_Angeles"),
  clientId: z.string().min(8).max(64),
});

export const Route = createFileRoute("/api/inbox")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const session = await readGoogleSession();
        const result = await fetchGmail({
          refreshToken: session.refreshToken ?? null,
          query: url.searchParams.get("q") ?? undefined,
          max: Number(url.searchParams.get("max")) || undefined,
        });
        return json(
          { ...result, defaultQuery: DEFAULT_QUERY },
          result.ok ? 200 : result.connected ? 502 : 200,
        );
      },

      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, code: "bad_request", message: "Invalid JSON body." }, 400);
        }

        const parsed = ExtractSchema.safeParse(body);
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

        if (!input.messageId && !input.text?.trim()) {
          return json(
            { ok: false, code: "invalid_input", message: "Provide either messageId or text." },
            422,
          );
        }

        if (!serverEnv.openaiApiKey) {
          return json(
            {
              ok: false,
              code: "missing_key",
              message: "Extraction needs OPENAI_API_KEY on the server.",
            },
            503,
          );
        }

        // Extraction is the most expensive call in the app: a full email body,
        // not a one-line note. Keep the window tighter than quick-add's.
        const limit = checkRateLimit(callerKey(request, input.clientId), {
          windowSec: 60,
          max: 6,
          dailyMax: serverEnv.openaiDailyRequestCap,
        });
        if (!limit.allowed) {
          return json(
            {
              ok: false,
              code: "rate_limited",
              message: `Too many extractions. Try again in ${limit.retryAfterSec}s.`,
            },
            429,
            { "retry-after": String(limit.retryAfterSec) },
          );
        }

        let source = {
          subject: input.subject ?? "(pasted text)",
          from: input.from ?? "(pasted by hand)",
          receivedAt: isoOrNow(input.receivedAt),
          body: input.text ?? "",
        };

        // A messageId means "fetch it from Gmail" — the body is authoritative
        // there, so it overrides anything the client sent.
        if (input.messageId) {
          const session = await readGoogleSession();
          const inbox = await fetchGmail({ refreshToken: session.refreshToken ?? null, max: 40 });
          if (!inbox.ok) {
            return json(
              {
                ok: false,
                code: "gmail_unavailable",
                message: inbox.error ?? "Gmail unavailable.",
              },
              502,
            );
          }
          const message = inbox.messages.find((m) => m.id === input.messageId);
          if (!message) {
            return json(
              {
                ok: false,
                code: "not_found",
                message: "That message is no longer in the current inbox query.",
              },
              404,
            );
          }
          source = {
            subject: message.subject,
            from: message.from,
            receivedAt: message.receivedAt,
            body: message.body || message.snippet,
          };
        }

        if (!source.body.trim()) {
          return json(
            { ok: false, code: "empty", message: "That message has no readable text." },
            422,
          );
        }

        const result = await extractItemsFromEmail(source, {
          now: new Date().toISOString(),
          timezone: input.timezone,
          clientId: input.clientId,
        });

        if (!result.ok) return json(result, 502);

        // Re-validate the model's output, and drop anything that lost its date
        // in translation — an event with no start is not an event.
        const items = (result.items ?? [])
          .map((raw) => ItemSchema.safeParse(raw))
          .filter((r): r is { success: true; data: z.infer<typeof ItemSchema> } => r.success)
          .map((r) => r.data)
          .filter((item) => (item.kind === "event" ? Boolean(item.startAt) : true));

        return json({
          ok: true,
          remainingToday: limit.remaining,
          items,
          ...(result.note ? { note: result.note } : {}),
          source: { subject: source.subject, from: source.from, receivedAt: source.receivedAt },
        });
      },
    },
  },
});

/** Null-tolerant: the strict JSON schema returns null rather than omitting a key. */
const nullableString = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((v) => v ?? undefined);

const ItemSchema = z
  .object({
    kind: z.enum(["event", "task"]),
    title: z.string().min(1).max(200),
    description: nullableString(2000),
    location: nullableString(250),
    startAt: nullableString(40),
    endAt: nullableString(40),
    allDay: z.boolean(),
    dueAt: nullableString(40),
    category: z.enum(["school", "work", "personal"]),
    priority: z.enum(["urgent", "high", "normal", "low"]),
    estimateMin: z.number().int().min(5).max(600).catch(60),
    evidence: nullableString(600),
  })
  .transform((item) => ({
    ...item,
    // A model can return a syntactically valid but unparseable date string.
    startAt: validInstant(item.startAt),
    endAt: validInstant(item.endAt),
    dueAt: validInstant(item.dueAt),
  }));

function validInstant(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isoOrNow(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

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

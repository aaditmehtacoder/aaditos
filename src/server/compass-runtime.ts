/**
 * Server-side Compass runtime.
 *
 * Uses the official OpenAI SDK and the Responses API with:
 *   - streaming output
 *   - strict-schema function calling
 *   - `store: false` (nothing is retained on OpenAI's side)
 *   - a hashed `safety_identifier` so abuse can be traced without exposing who
 *     the user is
 *   - an under-18 appropriate system policy, per OpenAI's minor-safety guidance
 *
 * The API key never leaves this module. If it is missing, callers get a clean
 * `missing_key` error rather than a fabricated answer.
 */

import OpenAI from "openai";

import { hashIdentifier } from "@/lib/core/ids";
import { COMPASS_TOOLS, isWriteTool, runTool } from "@/lib/compass/tools";
import type {
  CompassEvent,
  CompassMessage,
  CompassSnapshot,
  CompassToolName,
} from "@/lib/compass/types";

import { serverEnv } from "./env";

const MAX_TOOL_ROUNDS = 4;

export class CompassConfigError extends Error {
  code = "missing_key" as const;
}

function client(): OpenAI {
  const apiKey = serverEnv.openaiApiKey;
  if (!apiKey) throw new CompassConfigError("OPENAI_API_KEY is not configured on the server.");
  return new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000 });
}

const TONE_GUIDANCE: Record<string, string> = {
  concise: "Answer in as few words as possible. Prefer lists over paragraphs. No preamble.",
  coach: "Be warm and encouraging, but still short. One motivating sentence maximum.",
  detailed: "Explain your reasoning briefly after the answer, in at most three sentences.",
};

export function systemInstructions(snapshot: CompassSnapshot, tone: string): string {
  return [
    "You are Compass, the assistant inside AaditOS — a private personal operating system.",
    `The user is ${snapshot.profile.name}, a 14-year-old ninth grader at ${snapshot.profile.school} in ${snapshot.profile.city}.`,
    "",
    "Safety (the user is a minor):",
    "- Keep everything age-appropriate for a 14-year-old. No sexual, violent, self-harm, extremist, gambling, alcohol/drug, or otherwise adult content.",
    "- Never give medical, legal, or financial advice. Suggest talking to a parent, teacher, or counsellor instead.",
    "- If a message suggests self-harm, abuse, or a crisis, stop planning, respond with care, and point to a trusted adult and the 988 Suicide & Crisis Lifeline (call or text 988 in the US).",
    "- Do not help with academic dishonesty. Help the user understand, plan, outline and revise their own work; never write a graded assignment for them to submit as their own.",
    "- Never ask for or repeat passwords, API keys, addresses, or payment details.",
    "",
    "How to work:",
    "- Call the read tools to get real data before answering. Never invent tasks, dates, grades, or events.",
    "- `propose_task` and `update_task` do NOT save anything. They create a proposal the user must confirm. Say so plainly.",
    "- You cannot send messages, email anyone, delete anything, or act outside AaditOS.",
    `- Today is ${snapshot.now} (${snapshot.timezone}). ${snapshot.schoolDay.reason}.`,
    snapshot.isDemo
      ? "- This workspace is running on DEMO data. Mention that when the answer depends on it."
      : "",
    "",
    "Style:",
    TONE_GUIDANCE[tone] ?? TONE_GUIDANCE["concise"]!,
    "- Use the user's own task and course names exactly.",
    "- Give times in the user's local timezone, e.g. '4:00 PM'.",
    "- When you use a tool result, state the number you used so the answer is checkable.",
  ]
    .filter(Boolean)
    .join("\n");
}

interface FunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

type InputItem = Record<string, unknown>;

export interface RunOptions {
  messages: CompassMessage[];
  snapshot: CompassSnapshot;
  tone: string;
  clientId: string;
  signal?: AbortSignal | undefined;
}

/**
 * Runs a full turn (model → tools → model) and yields wire events.
 * Never throws for expected failures; it emits an `error` event instead.
 */
export async function* runCompassTurn(opts: RunOptions): AsyncGenerator<CompassEvent> {
  let openai: OpenAI;
  try {
    openai = client();
  } catch (error) {
    yield {
      type: "error",
      code: "missing_key",
      message:
        error instanceof CompassConfigError
          ? error.message
          : "Compass is not configured on this server.",
      retryable: false,
    };
    return;
  }

  const safetyIdentifier = await hashIdentifier(opts.clientId, serverEnv.safetyIdentifierSalt);
  const instructions = systemInstructions(opts.snapshot, opts.tone);

  const input: InputItem[] = opts.messages.slice(-12).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    let stream: AsyncIterable<Record<string, unknown>>;
    try {
      stream = (await openai.responses.create(
        {
          model: serverEnv.openaiModel,
          instructions,
          input: input as never,
          tools: lastRound ? [] : (COMPASS_TOOLS as never),
          tool_choice: "auto",
          stream: true,
          store: false,
          safety_identifier: safetyIdentifier,
          max_output_tokens: serverEnv.openaiMaxOutputTokens,
          metadata: { app: "aaditos", surface: "compass" },
        },
        { signal: opts.signal },
      )) as unknown as AsyncIterable<Record<string, unknown>>;
    } catch (error) {
      yield toErrorEvent(error);
      return;
    }

    const calls: FunctionCallItem[] = [];
    let sawText = false;

    try {
      for await (const event of stream) {
        const type = event["type"];
        if (type === "response.output_text.delta") {
          const delta = event["delta"];
          if (typeof delta === "string" && delta.length > 0) {
            sawText = true;
            yield { type: "text", delta };
          }
        } else if (type === "response.output_item.done") {
          const item = event["item"] as Record<string, unknown> | undefined;
          if (item && item["type"] === "function_call") {
            calls.push({
              type: "function_call",
              call_id: String(item["call_id"] ?? ""),
              name: String(item["name"] ?? ""),
              arguments: typeof item["arguments"] === "string" ? item["arguments"] : "{}",
            });
          }
        } else if (type === "response.completed" || type === "response.incomplete") {
          const response = event["response"] as Record<string, unknown> | undefined;
          const usage = response?.["usage"] as Record<string, unknown> | undefined;
          inputTokens += Number(usage?.["input_tokens"] ?? 0);
          outputTokens += Number(usage?.["output_tokens"] ?? 0);
        } else if (type === "response.failed" || type === "error") {
          const response = event["response"] as Record<string, unknown> | undefined;
          const err = (response?.["error"] ?? event["error"]) as
            Record<string, unknown> | undefined;
          yield {
            type: "error",
            code: String(err?.["code"] ?? "model_error"),
            message: String(err?.["message"] ?? "The model could not complete this request."),
            retryable: true,
          };
          return;
        }
      }
    } catch (error) {
      yield toErrorEvent(error);
      return;
    }

    if (calls.length === 0) {
      if (!sawText) {
        yield {
          type: "error",
          code: "empty_response",
          message: "Compass returned an empty response. Try rephrasing your question.",
          retryable: true,
        };
        return;
      }
      yield { type: "done", usage: { inputTokens, outputTokens } };
      return;
    }

    for (const call of calls) {
      const name = call.name as CompassToolName;
      yield { type: "tool", name, status: "running" };

      let parsed: unknown = {};
      try {
        parsed = JSON.parse(call.arguments || "{}");
      } catch {
        parsed = {};
      }

      const outcome = runTool(name, parsed, opts.snapshot);
      yield { type: "tool_result", name, data: outcome.data };
      if (outcome.proposal) yield { type: "proposal", proposal: outcome.proposal };

      input.push({
        type: "function_call",
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments,
      });
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(
          isWriteTool(name)
            ? {
                ...(outcome.data as Record<string, unknown>),
                note: "Nothing was saved. The user must confirm this proposal in the UI.",
              }
            : outcome.data,
        ).slice(0, 24_000),
      });
    }
  }

  yield { type: "done", usage: { inputTokens, outputTokens } };
}

function toErrorEvent(error: unknown): CompassEvent {
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    if (status === 401) {
      return {
        type: "error",
        code: "invalid_key",
        message: "The configured OPENAI_API_KEY was rejected. Check it in your host's settings.",
        retryable: false,
      };
    }
    if (status === 429) {
      return {
        type: "error",
        code: "rate_limited",
        message: "OpenAI rate limit reached. Wait a moment and try again.",
        retryable: true,
      };
    }
    if (status === 400 && /model/i.test(error.message)) {
      return {
        type: "error",
        code: "bad_model",
        message: `The model "${serverEnv.openaiModel}" is not available to this key. Set OPENAI_MODEL to one you can use.`,
        retryable: false,
      };
    }
    return {
      type: "error",
      code: `openai_${status || "error"}`,
      message: error.message,
      retryable: status >= 500,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { type: "error", code: "aborted", message: "Request cancelled.", retryable: false };
  }
  return {
    type: "error",
    code: "network",
    message: "Could not reach OpenAI. Check the server's network access.",
    retryable: true,
  };
}

// ---- structured task proposal (non-streaming) ----------------------------

export interface StructuredTaskResult {
  ok: boolean;
  draft?: unknown;
  code?: string;
  message?: string;
}

export async function proposeTaskStructured(
  text: string,
  ctx: { courses: string[]; projects: string[]; now: string; timezone: string; clientId: string },
): Promise<StructuredTaskResult> {
  let openai: OpenAI;
  try {
    openai = client();
  } catch {
    return {
      ok: false,
      code: "missing_key",
      message: "Compass is not configured. Add OPENAI_API_KEY on the server to enable this.",
    };
  }

  const safetyIdentifier = await hashIdentifier(ctx.clientId, serverEnv.safetyIdentifierSalt);

  try {
    const response = await openai.responses.create({
      model: serverEnv.openaiModel,
      store: false,
      safety_identifier: safetyIdentifier,
      max_output_tokens: 600,
      instructions: [
        "Convert the user's note into one structured task for a 14-year-old student's planner.",
        `Now is ${ctx.now} in ${ctx.timezone}. Resolve relative dates against it and return ISO-8601 UTC instants.`,
        `Known courses: ${ctx.courses.join(", ") || "none"}.`,
        `Known projects: ${ctx.projects.join(", ") || "none"}.`,
        "Only set courseName or projectName to an exact value from those lists, otherwise null.",
        "Keep the title short and action-first. Estimate a realistic duration in minutes.",
        "Keep everything age-appropriate. Nothing is saved — this is a preview the user confirms.",
      ].join("\n"),
      input: text.slice(0, 1000),
      text: {
        format: {
          type: "json_schema",
          name: "task_draft",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: ["string", "null"] },
              category: { type: "string", enum: ["school", "work", "personal"] },
              courseName: { type: ["string", "null"] },
              projectName: { type: ["string", "null"] },
              dueAt: { type: ["string", "null"] },
              dueAllDay: { type: "boolean" },
              priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
              estimateMin: { type: "integer" },
              subtasks: { type: "array", items: { type: "string" } },
            },
            required: [
              "title",
              "description",
              "category",
              "courseName",
              "projectName",
              "dueAt",
              "dueAllDay",
              "priority",
              "estimateMin",
              "subtasks",
            ],
          },
        },
      },
    });

    const raw = (response as { output_text?: string }).output_text;
    if (!raw) return { ok: false, code: "empty_response", message: "Compass returned nothing." };
    return { ok: true, draft: JSON.parse(raw) as unknown };
  } catch (error) {
    const event = toErrorEvent(error);
    return {
      ok: false,
      code: event.type === "error" ? event.code : "error",
      message: event.type === "error" ? event.message : "Request failed.",
    };
  }
}

// ---- email → many items --------------------------------------------------

/**
 * Pulls every dated commitment out of one message.
 *
 * A club email is not one task. A single WBE announcement can carry a cancelled
 * meeting, a first meeting three days out, two volunteer shifts on different
 * days with different hours, and a sign-up deadline — so this returns an array,
 * not a single draft.
 *
 * Two rules matter more than anything else here:
 *
 *   - The email's *own* received date anchors relative wording. "This Wednesday"
 *     in a message sent last Monday is not this Wednesday now.
 *   - Every item carries `evidence`: the sentence it came from. A wrong time is
 *     then traceable to the line that produced it instead of being unexplainable.
 *
 * Nothing is saved. The caller previews these and the user confirms each one.
 */
export async function extractItemsFromEmail(
  source: { subject: string; from: string; receivedAt: string; body: string },
  ctx: { now: string; timezone: string; clientId: string },
): Promise<{ ok: boolean; items?: unknown[]; note?: string; code?: string; message?: string }> {
  let openai: OpenAI;
  try {
    openai = client();
  } catch {
    return {
      ok: false,
      code: "missing_key",
      message: "Compass is not configured. Add OPENAI_API_KEY on the server to enable this.",
    };
  }

  const safetyIdentifier = await hashIdentifier(ctx.clientId, serverEnv.safetyIdentifierSalt);

  try {
    const response = await openai.responses.create({
      model: serverEnv.openaiModel,
      store: false,
      safety_identifier: safetyIdentifier,
      max_output_tokens: 2000,
      instructions: [
        "Extract every dated commitment from this email for a 14-year-old student's planner.",
        "",
        "Dates — the most important part:",
        `- The email was received at ${source.receivedAt}. Resolve relative wording ("this Wednesday", "next week", "tomorrow") against THAT instant, not against now.`,
        `- Now is ${ctx.now}. The timezone for every local time in the email is ${ctx.timezone}.`,
        "- Return every startAt/endAt/dueAt as an ISO-8601 UTC instant.",
        "- When the email gives a weekday AND a calendar date, trust the calendar date.",
        "- 'after school' with no clock time means 3:30 PM local. An all-day item sets allDay true and needs no time.",
        "",
        "What counts:",
        "- kind 'event' for anything that happens at a time and place: meetings, shifts, rehearsals, games, competitions.",
        "- kind 'task' for something to do by a deadline: sign up, submit, bring, pay, RSVP.",
        "- One item per distinct date. A volunteer opportunity listed on two days is TWO events, each with its own hours.",
        "- A sign-up, RSVP or registration that gates a dated event IS a task: set dueAt to just before that event starts, and name where to sign up in the description.",
        "- Skip anything cancelled ('no meeting this week'), already past relative to now, or purely informational.",
        "- Never invent a date out of nothing. If an activity has no date and gates nothing dated, leave it out.",
        "",
        "For each item, quote the exact sentence it came from in `evidence` so a wrong date is traceable.",
        "Set location to the room or address when the email gives one, e.g. 'Room N102'.",
        "Return an empty items array if the email carries nothing actionable, and say why in `note`.",
      ].join("\n"),
      input: [
        `From: ${source.from}`,
        `Subject: ${source.subject}`,
        `Received: ${source.receivedAt}`,
        "",
        source.body.slice(0, 8000),
      ].join("\n"),
      text: {
        format: {
          type: "json_schema",
          name: "extracted_items",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              note: { type: ["string", "null"] },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    kind: { type: "string", enum: ["event", "task"] },
                    title: { type: "string" },
                    description: { type: ["string", "null"] },
                    location: { type: ["string", "null"] },
                    startAt: { type: ["string", "null"] },
                    endAt: { type: ["string", "null"] },
                    allDay: { type: "boolean" },
                    dueAt: { type: ["string", "null"] },
                    category: { type: "string", enum: ["school", "work", "personal"] },
                    priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
                    estimateMin: { type: "integer" },
                    evidence: { type: ["string", "null"] },
                  },
                  required: [
                    "kind",
                    "title",
                    "description",
                    "location",
                    "startAt",
                    "endAt",
                    "allDay",
                    "dueAt",
                    "category",
                    "priority",
                    "estimateMin",
                    "evidence",
                  ],
                },
              },
            },
            required: ["items", "note"],
          },
        },
      },
    });

    const raw = (response as { output_text?: string }).output_text;
    if (!raw) return { ok: false, code: "empty_response", message: "Compass returned nothing." };
    const parsed = JSON.parse(raw) as { items?: unknown[]; note?: string | null };
    return {
      ok: true,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      ...(parsed.note ? { note: parsed.note } : {}),
    };
  } catch (error) {
    const event = toErrorEvent(error);
    return {
      ok: false,
      code: event.type === "error" ? event.code : "error",
      message: event.type === "error" ? event.message : "Request failed.",
    };
  }
}

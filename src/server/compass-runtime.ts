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

export function systemInstructions(snapshot: CompassSnapshot): string {
  return [
    "You are the assistant inside AaditOS, a private planner belonging to one person.",
    `That person is ${snapshot.profile.name}, a 14-year-old ninth grader at ${snapshot.profile.school} in ${snapshot.profile.city}.`,
    "",
    "Safety (the user is a minor):",
    "- Keep everything age-appropriate for a 14-year-old. No sexual, violent, self-harm, extremist, gambling, alcohol/drug, or otherwise adult content.",
    "- Never give medical, legal, or financial advice. Point to a parent, teacher, or counsellor instead.",
    "- If a message suggests self-harm, abuse, or a crisis, stop planning, respond with care, and name a trusted adult and the 988 Suicide & Crisis Lifeline (call or text 988 in the US).",
    "- Do not do graded work for them. Help them understand, plan, outline and revise their own work; never write something they would hand in as theirs.",
    "- Never ask for or repeat passwords, API keys, addresses, or payment details.",
    "",
    "Read before you answer:",
    "- Call the read tools first. Never invent a task, a date, a grade, or an event; if a tool returns nothing, say so rather than filling the gap.",
    "- `list_notes` is the one most answers are missing. Notes are what the user wrote for themselves — what a teacher actually asked for, what they got stuck on, an idea they had. A deadline says a paper is due Friday; a note says the thesis has to be arguable and theirs currently is not. Read them before advising on a class, an assignment, or what to work on.",
    "- State the numbers you used, so the answer can be checked instead of trusted.",
    "",
    "Answer like someone who knows the situation:",
    "- Lead with the answer. No preamble, no restating the question, no 'Great question'.",
    "- Be specific to their actual work. Use their exact task and class names. 'Start the Financial Lit packet — it is 30 minutes and you have 45' beats 'prioritize by deadline'.",
    "- Short. A few sentences, or a list when there are genuinely several things. Never pad.",
    "- Say the hard thing when it is true. If five assignments are missing, lead with that instead of building an encouraging plan around it.",
    "- Give times in their local timezone, e.g. '4:00 PM'. Say 'tomorrow' and 'Friday', not ISO timestamps.",
    "- When something is genuinely fine, say so in one line and stop. Do not manufacture work.",
    "",
    "What you can and cannot do:",
    "- `propose_task` and `update_task` save nothing. They put a card in front of the user to confirm. Say plainly that nothing is saved yet.",
    "- You cannot send messages, email anyone, delete anything, or act outside this app.",
    `- Now is ${snapshot.now} (${snapshot.timezone}). ${snapshot.schoolDay.reason}.`,
    snapshot.schoolDay.nextClass ? `- Next class: ${snapshot.schoolDay.nextClass}.` : "",
    `- Their classes are: ${snapshot.courses.join(", ") || "not synced yet"}.`,
    snapshot.isDemo
      ? "- This workspace is running on DEMO data. Say so whenever the answer depends on it."
      : "",
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
  const instructions = systemInstructions(opts.snapshot);

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

// ---- capture: any text in, filed items out ------------------------------

/**
 * One box for everything.
 *
 * The reason a todo list is hard to keep is that most of what you need to
 * remember does not arrive as a todo. It arrives as a sentence — "fin lit
 * packet friday", a club email with four dates buried in it, or "Robson wants
 * the thesis arguable", which is not a task at all and never will be. A box
 * that only accepts tasks makes you do the sorting, so you stop using it.
 *
 * This does the sorting instead, and returns three kinds of thing:
 *
 *   - `task`  something to finish, with a deadline it can work out
 *   - `event` something that happens at a time, with a place
 *   - `note`  a thought or an idea about a class, which has no date and must
 *             not be given a fake one
 *
 * Two rules carry most of the accuracy. Relative wording ("this Thursday") is
 * resolved against when the text was *written*, not when it is pasted — a
 * week-old email says something different from a fresh one. And every item
 * quotes the words it came from in `evidence`, so a wrong date is traceable to
 * the line that produced it rather than being unexplainable.
 */
export interface CaptureResult {
  ok: boolean;
  items?: unknown[];
  note?: string;
  code?: string;
  message?: string;
}

export async function captureItems(
  text: string,
  ctx: {
    now: string;
    timezone: string;
    courses: string[];
    /** "Class — Teacher" pairs, so a teacher's name resolves to their class. */
    teachers?: string[] | undefined;
    clientId: string;
    /** When the text was written, if known — an email's Received date. */
    writtenAt?: string | undefined;
  },
): Promise<CaptureResult> {
  let openai: OpenAI;
  try {
    openai = client();
  } catch {
    return {
      ok: false,
      code: "missing_key",
      message: "The assistant is not configured. Add OPENAI_API_KEY on the server.",
    };
  }

  const safetyIdentifier = await hashIdentifier(ctx.clientId, serverEnv.safetyIdentifierSalt);

  try {
    const response = await openai.responses.create({
      model: serverEnv.openaiModel,
      store: false,
      safety_identifier: safetyIdentifier,
      max_output_tokens: Math.min(2400, serverEnv.openaiMaxOutputTokens * 2),
      instructions: [
        "You sort whatever a 14-year-old ninth grader types or pastes into their planner. The input may be one line, a messy brain dump, or a whole pasted email.",
        "",
        'FIRST, before anything else: break the input into every separate piece of meaning it contains, and file each one as its own item. Most inputs contain more than one. A single sentence joined by "and" is usually two items, and they are often different kinds — a deadline AND an observation about the work. Never merge two pieces into one item, and never drop the second half of what someone typed.',
        "",
        "Then give each piece a kind:",
        "- 'task' — something to finish. Give it a dueAt when the text implies one.",
        "- 'event' — something that happens at a time and place: a meeting, practice, shift, game.",
        "- 'note' — a thought, an observation, something a teacher said, a question to ask, or an idea. It has NO date and never gets one. Use 'note' whenever a piece is about understanding or remembering rather than doing something by a deadline.",
        "",
        'Worked example. Input: "algebra pset due tues, and I keep messing up the sign when I factor"',
        "Correct output: TWO items.",
        '  1. task "Finish Algebra 2 problem set", courseName "Algebra 2", dueAt Tuesday.',
        '  2. note "I keep messing up the sign when I factor", noteKind "thought", courseName "Algebra 2", dueAt null.',
        "Filing only the task there would be wrong.",
        "",
        "Notes in detail:",
        "- title is the thought written out in full and readable — not a summary, not a shortened label.",
        "- noteKind 'idea' for something they might do; 'thought' for something they noticed, were told, or want to remember.",
        "- A note about a class MUST carry its courseName; that is how it reaches the right class page.",
        "",
        "Dates:",
        `- Now is ${ctx.now}. Local times are ${ctx.timezone}. Return every dueAt/startAt/endAt as an ISO-8601 UTC instant.`,
        ctx.writtenAt
          ? `- This text was written at ${ctx.writtenAt}. Resolve relative wording ("this Thursday", "next week") against THAT instant, not against now.`
          : "- Resolve relative wording against now.",
        "- When a weekday and a calendar date are both given, trust the calendar date.",
        '- A bare weekday with no time means the end of that day, local. "after school" with no clock time means 3:30 PM local. An all-day item sets allDay true.',
        "- Skip anything cancelled, or already past relative to now.",
        "- Never invent a date. No date implied means dueAt null — normal and fine.",
        "",
        "Classes:",
        `- Known classes: ${ctx.courses.join(", ") || "none"}.`,
        ctx.teachers && ctx.teachers.length > 0
          ? `- Who teaches what: ${ctx.teachers.join("; ")}. A teacher's name in the text tells you the class.`
          : "",
        '- Set courseName only to an exact class name from that list, otherwise null. Match loose wording to the real name: "fin lit" is Financial Lit, "bio" is Biology, "english" is English 9 H.',
        "",
        "Splitting further:",
        "- One item per distinct thing. Three dates in one email is three items.",
        "- A sign-up that gates a dated event is its own task, due just before that event starts.",
        "- Do not split one thought into several notes.",
        "",
        "Task titles are short and action-first. Estimate a realistic duration in minutes for tasks. Quote the words each item came from in `evidence`.",
        "Keep everything age-appropriate. Return an empty items array and say why in `note` only if there is genuinely nothing to file.",
      ]
        .filter(Boolean)
        .join("\n"),
      input: text.slice(0, 8000),
      text: {
        format: {
          type: "json_schema",
          name: "captured_items",
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
                    kind: { type: "string", enum: ["task", "event", "note"] },
                    title: { type: "string" },
                    description: { type: ["string", "null"] },
                    courseName: { type: ["string", "null"] },
                    location: { type: ["string", "null"] },
                    dueAt: { type: ["string", "null"] },
                    startAt: { type: ["string", "null"] },
                    endAt: { type: ["string", "null"] },
                    allDay: { type: "boolean" },
                    category: { type: "string", enum: ["school", "work", "personal"] },
                    priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
                    estimateMin: { type: "integer" },
                    noteKind: { type: ["string", "null"], enum: ["thought", "idea", null] },
                    evidence: { type: ["string", "null"] },
                  },
                  required: [
                    "kind",
                    "title",
                    "description",
                    "courseName",
                    "location",
                    "dueAt",
                    "startAt",
                    "endAt",
                    "allDay",
                    "category",
                    "priority",
                    "estimateMin",
                    "noteKind",
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
    if (!raw)
      return { ok: false, code: "empty_response", message: "The assistant returned nothing." };
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

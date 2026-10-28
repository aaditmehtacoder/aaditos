/**
 * Server-side Compass runtime.
 *
 * Uses the official OpenAI SDK and the Responses API with:
 *   - streaming output
 *   - strict-schema function calling over the user's own workspace
 *   - the built-in `image_generation` tool, so "draw me…" works in the same
 *     conversation as "what is due?"
 *   - images and PDFs as input, by URL, so a conversation full of files
 *     never has to fit in one request body
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

import { ExhaustedError, NoKeyError, classify, ladder, withFallback, type Rung } from "./ai";
import { serverEnv } from "./env";

const MAX_TOOL_ROUNDS = 4;
/** Mid-stream provider failures before any text: how many times to restart the round further down the ladder. */
const MAX_STREAM_RESTARTS = 2;
/** Messages of history that travel with each turn. Files in them travel too. */
export const HISTORY_WINDOW = 20;
/** Generated pictures leave the model as this. WebP at 85 is a quarter of the PNG. */
const IMAGE_MIME = "image/webp";

export class CompassConfigError extends Error {
  code = "missing_key" as const;
}

/**
 * When every image model reported no budget, the painter is left out of
 * requests for a while. Without this, each "draw me…" would burn one chat
 * request per image model before giving up, on an account where the chat
 * budget is the scarce thing.
 */
let imagesDisabledUntil = 0;
const IMAGES_DISABLED_MS = 30 * 60_000;

export function imagesCurrentlyDisabled(now = Date.now()): boolean {
  return now < imagesDisabledUntil;
}

/** Testing hook. */
export function resetImageAvailability(): void {
  imagesDisabledUntil = 0;
}

export function systemInstructions(
  snapshot: CompassSnapshot,
  opts: { pictures?: "on" | "off" | "unavailable" } = {},
): string {
  return [
    "You are the assistant inside AaditOS: a general assistant — writing, explaining, coding, maths, studying, brainstorming, pictures — that also lives inside one person's private planner and can read it.",
    `That person is ${snapshot.profile.name}, a 14-year-old ninth grader at ${snapshot.profile.school} in ${snapshot.profile.city}.`,
    "",
    "Safety (the user is a minor):",
    "- Keep everything age-appropriate for a 14-year-old. No sexual, violent, self-harm, extremist, gambling, alcohol/drug, or otherwise adult content, in text or in pictures.",
    "- Never give medical, legal, or financial advice. Point to a parent, teacher, or counsellor instead.",
    "- If a message suggests self-harm, abuse, or a crisis, stop planning, respond with care, and name a trusted adult and the 988 Suicide & Crisis Lifeline (call or text 988 in the US).",
    "- Do not do graded work for them. Help them understand, plan, outline and revise their own work; never write something they would hand in as theirs.",
    "- Never ask for or repeat passwords, API keys, addresses, or payment details.",
    "",
    "Files:",
    "- They can attach any number of images and PDFs. Read every one fully before answering. For a PDF, answer from its contents and cite the page when you can; for a photo, read everything legible in it.",
    "- If a file is unreadable or missing, say which one, rather than guessing at it.",
    "",
    "Pictures:",
    opts.pictures === "unavailable"
      ? "- Picture-making is switched off right now because the OpenAI account has no image credit. If they ask for a picture, say that in one line (a payment method on the OpenAI billing page turns it on) and offer to describe or plan it in words instead."
      : opts.pictures === "off"
        ? "- Picture-making is not available in this session. If they ask for one, say so in one line and help in words instead."
        : "- When they ask for a picture, drawing, poster, logo, diagram, icon, mockup, or to change an image they attached or you made earlier, call the image_generation tool. Do not describe the tool or ask for permission; make the picture, then say one short line about what you made.",
    opts.pictures === "on" || opts.pictures === undefined
      ? "- An image they attached in the latest message is what 'this', 'it' and 'make it…' refer to."
      : "",
    "- Pictures must be age-appropriate: no real people's faces, nothing violent or adult, no brand logos they do not own.",
    "",
    "Their planner:",
    "- When the question is about their day, classes, tasks, deadlines, notes, calendar, inbox or what to do next, call the read tools first. Never invent a task, a date, a grade, or an event; if a tool returns nothing, say so rather than filling the gap.",
    "- `list_notes` is the one most planner answers are missing. Notes are what the user wrote for themselves — what a teacher actually asked for, what they got stuck on, an idea they had. Read them before advising on a class, an assignment, or what to work on.",
    "- State the numbers you used, so the answer can be checked instead of trusted.",
    "- For everything else — a general question, homework help, writing, code, an explanation — answer directly without tools.",
    "",
    "How to answer:",
    "- Lead with the answer. No preamble, no restating the question, no 'Great question'.",
    "- Be specific to their actual situation. Use their exact task and class names. 'Start the Financial Lit packet — it is 30 minutes and you have 45' beats 'prioritize by deadline'.",
    "- As long as it needs to be and no longer. One line when one line is the answer; a full explanation, a study guide or working code when that is what was asked for.",
    "- Say the hard thing when it is true. If five assignments are missing, lead with that instead of building an encouraging plan around it.",
    "- Give times in their local timezone, e.g. '4:00 PM'. Say 'tomorrow' and 'Friday', not ISO timestamps.",
    "- Markdown: headings only in long answers, fenced code blocks with a language for code, a table when comparing things, bold for the one thing to remember.",
    "",
    "What you can and cannot do:",
    "- `propose_task` and `update_task` save nothing. They put a card in front of the user to confirm. Say plainly that nothing is saved yet.",
    "- You cannot send messages, email anyone, delete anything, browse the web, or act outside this app.",
    `- Now is ${snapshot.now} (${snapshot.timezone}). ${snapshot.schoolDay.reason}.`,
    snapshot.schoolDay.nextClass ? `- Next class: ${snapshot.schoolDay.nextClass}.` : "",
    `- Their classes are: ${snapshot.courses.join(", ") || "not synced yet"}.`,
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

/**
 * The conversation as Responses API input items.
 *
 * A message with files becomes a content array: the text, then each image
 * as `input_image` and each PDF as `input_file`. Storage links are passed
 * through for the model to fetch; a local store's data URLs travel as
 * `file_data`, which is the only form OpenAI accepts bytes in. Older turns
 * keep their files too — "what did page 3 say?" has to still work five
 * messages later — which is why `HISTORY_WINDOW` is a window.
 */
export function toInputItems(messages: CompassMessage[]): InputItem[] {
  return messages.slice(-HISTORY_WINDOW).map((m) => {
    if (m.role === "assistant") return { role: "assistant", content: m.content };
    const attachments = m.attachments ?? [];
    if (attachments.length === 0) return { role: "user", content: m.content };

    const text = m.content.trim();
    const content: InputItem[] = [{ type: "input_text", text: text || "See the attached files." }];
    for (const attachment of attachments) {
      if (attachment.kind === "image") {
        content.push({ type: "input_image", image_url: attachment.url, detail: "auto" });
        continue;
      }
      // Bytes need a name to be read as a PDF; a link must not carry one
      // (OpenAI rejects `filename` next to `file_url`), and the link's own
      // `.pdf` suffix says what it is.
      const filename = /\.pdf$/i.test(attachment.name) ? attachment.name : `${attachment.name}.pdf`;
      content.push(
        attachment.url.startsWith("data:")
          ? { type: "input_file", filename, file_data: attachment.url }
          : { type: "input_file", file_url: attachment.url },
      );
    }
    return { role: "user", content };
  });
}

/** The painter, as a Responses tool. The chat model decides when to call it. */
export function imageTool(model: string): Record<string, unknown> {
  return {
    type: "image_generation",
    model,
    quality: "medium",
    // The smaller models only take the three fixed sizes.
    size: /mini/.test(model) ? "1024x1024" : "auto",
    output_format: "webp",
    output_compression: 85,
    // Two rough frames while it paints, so the wait is visible.
    partial_images: 2,
    moderation: "auto",
  };
}

/** Whether a failure is the image model's, not the chat model's. */
export function isImageModelFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /gpt-image|image_generation|image model|limit gpt-image|chatgpt-image/i.test(message);
}

export interface RunOptions {
  messages: CompassMessage[];
  snapshot: CompassSnapshot;
  clientId: string;
  signal?: AbortSignal | undefined;
  /** Offer the image tool. Off for guests: a picture costs real money on the owner's key. */
  allowImages?: boolean | undefined;
}

/**
 * Runs a full turn (model → tools → model) and yields wire events.
 * Never throws for expected failures; it emits an `error` event instead.
 */
export async function* runCompassTurn(opts: RunOptions): AsyncGenerator<CompassEvent> {
  const rungs = ladder();
  if (rungs.length === 0) {
    yield {
      type: "error",
      code: "missing_key",
      message: "OPENAI_API_KEY is not configured on the server.",
      retryable: false,
    };
    return;
  }

  const safetyIdentifier = await hashIdentifier(opts.clientId, serverEnv.safetyIdentifierSalt);
  const imageModels = serverEnv.openaiImageModels;
  const pictures = !opts.allowImages ? "off" : imagesCurrentlyDisabled() ? "unavailable" : "on";
  let instructions = systemInstructions(opts.snapshot, { pictures });
  const input = toInputItems(opts.messages);

  let inputTokens = 0;
  let outputTokens = 0;

  // Where on the ladder this turn currently stands. A rung that fails mid-stream
  // is not retried; the next round starts below it.
  let rungStart = 0;
  let restarts = 0;
  // The painter has its own, shorter ladder, walked independently of the chat one.
  let imageIndex = 0;
  let imagesOn = pictures === "on";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    const imageModel = imageModels[imageIndex];
    const tools = lastRound
      ? []
      : [...COMPASS_TOOLS, ...(imagesOn && imageModel ? [imageTool(imageModel)] : [])];

    let stream: AsyncIterable<Record<string, unknown>>;
    let rung: Rung;
    try {
      const result = await withFallback(
        (openai, current) =>
          openai.responses.create(
            {
              model: current.model,
              instructions,
              input: input as never,
              tools: tools as never,
              tool_choice: "auto",
              stream: true,
              store: false,
              safety_identifier: safetyIdentifier,
              max_output_tokens: serverEnv.openaiMaxOutputTokens,
              metadata: { app: "aaditos", surface: "compass" },
            },
            { signal: opts.signal },
          ) as unknown as Promise<AsyncIterable<Record<string, unknown>>>,
        { signal: opts.signal, rungs: rungs.slice(rungStart) },
      );
      stream = result.value;
      rung = result.rung;
      rungStart = rungs.indexOf(rung);
      if (result.skipped.length > 0) {
        console.warn("[compass] fell back", {
          to: rung.model,
          key: rung.keyIndex,
          skipped: result.skipped.map((s) => `${s.rung.model}: ${s.reason}`),
        });
      }
    } catch (error) {
      yield toErrorEvent(error);
      return;
    }

    const calls: FunctionCallItem[] = [];
    let sawText = false;
    let sawImage = false;
    let restartRound = false;
    let imageFailure: string | null = null;

    try {
      for await (const event of stream) {
        const type = event["type"];
        if (type === "response.output_text.delta") {
          const delta = event["delta"];
          if (typeof delta === "string" && delta.length > 0) {
            sawText = true;
            yield { type: "text", delta };
          }
        } else if (type === "response.output_item.added") {
          const item = event["item"] as Record<string, unknown> | undefined;
          if (item && item["type"] === "image_generation_call") {
            yield { type: "tool", name: "generate_image", status: "running" };
          }
        } else if (type === "response.image_generation_call.partial_image") {
          const b64 = event["partial_image_b64"];
          if (typeof b64 === "string" && b64.length > 0) {
            yield {
              type: "image",
              id: String(event["item_id"] ?? ""),
              b64,
              mime: IMAGE_MIME,
              partial: true,
            };
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
          } else if (item && item["type"] === "image_generation_call") {
            const result = item["result"];
            if (typeof result === "string" && result.length > 0) {
              sawImage = true;
              const format = String(item["output_format"] ?? "webp");
              yield {
                type: "image",
                id: String(item["id"] ?? ""),
                b64: result,
                mime: `image/${format === "jpg" ? "jpeg" : format}`,
                partial: false,
              };
              yield { type: "tool_result", name: "generate_image", data: { ok: true } };
            } else {
              imageFailure = String(item["status"] ?? "failed");
              yield { type: "tool_result", name: "generate_image", data: { ok: false } };
            }
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
          const message = String(err?.["message"] ?? "The model could not complete this request.");
          if (isImageModelFailure(message)) {
            throw Object.assign(new Error(message), { name: "ImageModelError" });
          }
          // Nothing has reached the user yet, so the round can quietly start
          // again one rung down instead of surfacing a provider hiccup.
          if (!sawText && restarts < MAX_STREAM_RESTARTS && rungStart + 1 < rungs.length) {
            console.warn("[compass] stream failed before any text; restarting round", {
              model: rung.model,
              code: String(err?.["code"] ?? "model_error"),
            });
            restarts += 1;
            rungStart += 1;
            restartRound = true;
            break;
          }
          yield {
            type: "error",
            code: String(err?.["code"] ?? "model_error"),
            message,
            retryable: true,
          };
          return;
        }
      }
    } catch (error) {
      if (isImageModelFailure(error)) {
        // The painter failed, not the chat model. Try the next painter on the
        // same chat rung; when none is left, say so and let text continue.
        if (imageIndex + 1 < imageModels.length) {
          console.warn("[compass] image model failed; trying the next", {
            from: imageModels[imageIndex],
            reason: error instanceof Error ? error.message.slice(0, 160) : "unknown",
          });
          imageIndex += 1;
          round -= 1;
          continue;
        }
        console.warn("[compass] every image model failed; continuing without pictures", {
          reason: error instanceof Error ? error.message.slice(0, 160) : "unknown",
        });
        if (
          /Limit 0|payment method|billing|quota/i.test(error instanceof Error ? error.message : "")
        ) {
          imagesDisabledUntil = Date.now() + IMAGES_DISABLED_MS;
        }
        yield {
          type: "error",
          code: "image_unavailable",
          message: pictureUnavailableMessage(error),
          retryable: false,
        };
        if (sawText) return;
        // Same question again, now told plainly that it cannot draw, so it
        // answers in words instead of improvising an SVG.
        imagesOn = false;
        instructions = systemInstructions(opts.snapshot, { pictures: "unavailable" });
        round -= 1;
        continue;
      }
      if (!sawText && !sawImage && restarts < MAX_STREAM_RESTARTS && rungStart + 1 < rungs.length) {
        const { retryable } = classify(error);
        if (retryable) {
          restarts += 1;
          rungStart += 1;
          round -= 1;
          continue;
        }
      }
      yield toErrorEvent(error);
      return;
    }

    if (restartRound) {
      round -= 1;
      continue;
    }

    if (imageFailure && !sawText && !sawImage && calls.length === 0) {
      yield {
        type: "error",
        code: "image_failed",
        message: "The picture could not be made this time. Try describing it differently.",
        retryable: true,
      };
      return;
    }

    if (calls.length === 0) {
      if (!sawText && !sawImage) {
        yield {
          type: "error",
          code: "empty_response",
          message: "Compass returned an empty response. Try rephrasing your question.",
          retryable: true,
        };
        return;
      }
      yield { type: "done", usage: { inputTokens, outputTokens }, model: rung.model };
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

/**
 * Why there is no picture, in a sentence the owner can act on. The one
 * failure seen in practice is an OpenAI project with no payment method: every
 * image model reports a budget of zero. That is fixed on OpenAI's billing
 * page, not here, so the message says so.
 */
export function pictureUnavailableMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (/Limit 0|rate_limit|payment method|billing|quota/i.test(raw)) {
    return (
      "Pictures are off until the OpenAI account has image credit: it currently reports a limit of zero for every image model. " +
      "Add a payment method at platform.openai.com → Settings → Billing and they will work with no other change. Text answers still work."
    );
  }
  return `The picture could not be made (${raw.slice(0, 140) || "unknown error"}). Text answers still work.`;
}

function toErrorEvent(error: unknown): CompassEvent {
  if (error instanceof NoKeyError) {
    return { type: "error", code: "missing_key", message: error.message, retryable: false };
  }
  if (error instanceof ExhaustedError) {
    const tried = [...new Set(error.attempts.map((a) => a.rung.model))];
    return {
      type: "error",
      code: "exhausted",
      message:
        `Every model was busy or out of quota (tried ${tried.join(", ")}). ` +
        `Last reason: ${error.attempts[error.attempts.length - 1]?.reason ?? "unknown"}. Try again in a moment.`,
      retryable: true,
    };
  }
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
    /**
     * Photos and screenshots as data URLs: an assignment sheet, a whiteboard,
     * a syllabus, a calendar. The model reads them like pasted text.
     */
    images?: string[] | undefined;
  },
): Promise<CaptureResult> {
  if (ladder().length === 0) {
    return {
      ok: false,
      code: "missing_key",
      message: "The assistant is not configured. Add OPENAI_API_KEY on the server.",
    };
  }

  const safetyIdentifier = await hashIdentifier(ctx.clientId, serverEnv.safetyIdentifierSalt);
  const images = (ctx.images ?? []).slice(0, 4);
  const content: Array<Record<string, unknown>> = [];
  const typed = text.slice(0, 8000).trim();
  if (typed) content.push({ type: "input_text", text: typed });
  else if (images.length > 0) {
    content.push({ type: "input_text", text: "File everything in the attached image(s)." });
  }
  for (const image of images) {
    content.push({ type: "input_image", image_url: image, detail: "auto" });
  }

  try {
    const { value: response, skipped } = await withFallback((openai, rung) =>
      openai.responses.create({
        model: rung.model,
        store: false,
        safety_identifier: safetyIdentifier,
        max_output_tokens: Math.min(2400, serverEnv.openaiMaxOutputTokens * 2),
        instructions: [
          "You sort whatever a 14-year-old ninth grader types or pastes into their planner. The input may be one line, a messy brain dump, a whole pasted email, or one or more images.",
          images.length > 0
            ? "Images are photos or screenshots of things like an assignment sheet, a whiteboard, a syllabus, a rubric, a calendar, or a message. Read everything legible in them and file it exactly as you would pasted text. Quote the words you read in `evidence`. If an image is unreadable, say so in `note` and file nothing from it."
            : "",
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
        input: [{ role: "user", content }] as never,
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
      }),
    );
    if (skipped.length > 0) {
      console.warn("[capture] fell back", {
        skipped: skipped.map((s) => `${s.rung.model}: ${s.reason}`),
      });
    }

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

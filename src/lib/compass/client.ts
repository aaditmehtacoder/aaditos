/** Browser-side helpers for talking to the Compass endpoints. */

import { newId } from "@/lib/core/ids";
import { TaskDraftSchema, type TaskDraft } from "@/lib/core/nl-task";
import { APP_TZ } from "@/lib/core/time";

import type { CompassEvent, CompassMessage, CompassSnapshot } from "./types";

const CLIENT_ID_KEY = "aaditos:client-id";

/** Random per-browser id. Used only for rate limiting and the hashed safety identifier. */
export function clientId(): string {
  if (typeof window === "undefined") return "server-render-client";
  try {
    let id = window.localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = newId().replace(/-/g, "").slice(0, 32);
      window.localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "no-storage-client";
  }
}

export interface StreamOptions {
  messages: CompassMessage[];
  snapshot: CompassSnapshot;
  signal?: AbortSignal | undefined;
  onEvent: (event: CompassEvent) => void;
}

export async function streamCompass(opts: StreamOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/compass", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: opts.messages,
        snapshot: opts.snapshot,
        clientId: clientId(),
      }),
      signal: opts.signal ?? null,
    });
  } catch {
    opts.onEvent({
      type: "error",
      code: "offline",
      message: "Could not reach the server. Check your connection and try again.",
      retryable: true,
    });
    return;
  }

  if (!response.body) {
    opts.onEvent({
      type: "error",
      code: "no_body",
      message: "The server returned an empty response.",
      retryable: true,
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (raw) emit(raw, opts.onEvent);
        newline = buffer.indexOf("\n");
      }
    }
    const tail = buffer.trim();
    if (tail) emit(tail, opts.onEvent);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return;
    opts.onEvent({
      type: "error",
      code: "stream_read",
      message: "The connection dropped while Compass was answering.",
      retryable: true,
    });
  }
}

function emit(raw: string, onEvent: (event: CompassEvent) => void): void {
  try {
    onEvent(JSON.parse(raw) as CompassEvent);
  } catch {
    // A partial or malformed frame is not worth surfacing to the user.
  }
}

export type ProposeResult =
  { ok: true; draft: TaskDraft } | { ok: false; error: string; code: string };

export async function proposeTaskFromText(
  text: string,
  ctx: { courses: string[]; projects: string[] },
): Promise<ProposeResult> {
  try {
    const response = await fetch("/api/compass/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        courses: ctx.courses,
        projects: ctx.projects,
        timezone: APP_TZ,
        clientId: clientId(),
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      draft?: unknown;
      message?: string;
      code?: string;
    };
    if (!payload.ok) {
      return {
        ok: false,
        code: payload.code ?? "error",
        error: payload.message ?? "Compass could not draft this task.",
      };
    }
    const parsed = TaskDraftSchema.safeParse(payload.draft);
    if (!parsed.success) {
      return { ok: false, code: "invalid_draft", error: "Compass returned an unusable draft." };
    }
    return { ok: true, draft: parsed.data };
  } catch {
    return { ok: false, code: "offline", error: "Could not reach Compass. Check your connection." };
  }
}

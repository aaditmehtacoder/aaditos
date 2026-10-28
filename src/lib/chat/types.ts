/**
 * A conversation with the assistant, as it is kept.
 *
 * Messages carry file *references*, never bytes: a photo lives in Storage
 * (or IndexedDB without Supabase) and the message points at it. That keeps a
 * chat with fifty pictures a few kilobytes, and means the same picture can
 * be shown again, sent again, or downloaded without ever being re-encoded.
 */

export type ChatFileKind = "image" | "pdf";

export interface ChatFile {
  id: string;
  kind: ChatFileKind;
  /** Original file name: shown, used for the download, sent to the model. */
  name: string;
  mimeType: string;
  size: number;
  width?: number | undefined;
  height?: number | undefined;
  /** `storage:<bucket path>` or `idb:<key>`. Resolved to a URL on display. */
  ref: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** What the user attached. */
  files: ChatFile[];
  /** What the assistant drew. */
  images: ChatFile[];
  createdAt: string;
  /** The model that answered, after any fallback. */
  model?: string | undefined;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** A title from the first thing said, short enough for a list. */
export function titleFor(text: string, fallback = "New chat"): string {
  const line = text
    .replace(/\s+/g, " ")
    .replace(/[#*_`>]/g, "")
    .trim();
  if (!line) return fallback;
  return line.length > 56 ? `${line.slice(0, 55).trimEnd()}…` : line;
}

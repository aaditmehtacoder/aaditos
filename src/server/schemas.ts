/**
 * Request schemas for every API route.
 *
 * Kept in one module so the routes and the tests validate against exactly the
 * same definitions. Sizes are capped so a hostile caller cannot inflate token
 * usage or memory through an oversized payload.
 */

import { z } from "zod";

import { SYNCABLE } from "@/lib/integrations/contracts";

/** A data URL for one image: png, jpeg, webp or gif, at most ~1.6 MB encoded. */
export const ImageDataUrlSchema = z
  .string()
  .max(1_700_000)
  .regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/, "Not an image data URL");

/** A data URL for one PDF. Demo mode only; signed-in users send a Storage URL. */
export const PdfDataUrlSchema = z
  .string()
  .max(4_000_000)
  .regex(/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/, "Not a PDF data URL");

const HttpsUrlSchema = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[^\s]+$/, "Not an https URL");

/**
 * One file on a chat message. Either a URL the model can fetch — checked
 * against the app's own Storage host in the route, since a schema cannot see
 * the environment — or, for demo mode, the bytes themselves as a data URL.
 */
export const WireAttachmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    name: z.string().max(200),
    url: z.union([HttpsUrlSchema, ImageDataUrlSchema]),
  }),
  z.object({
    kind: z.literal("pdf"),
    name: z.string().max(200),
    url: z.union([HttpsUrlSchema, PdfDataUrlSchema]),
  }),
]);

/**
 * Whether an attachment URL may be handed to the model.
 *
 * Only the app's own private bucket, through a signed link. Anything else —
 * another host, the bucket's public path, a path outside the bucket — is
 * refused, so the endpoint cannot be used to make OpenAI fetch arbitrary
 * URLs on this key's bill. Data URLs carry their own bytes and pass.
 */
export function attachmentUrlAllowed(url: string, storageOrigin: string | undefined): boolean {
  if (url.startsWith("data:")) return true;
  if (!storageOrigin) return false;
  try {
    const parsed = new URL(url);
    const origin = new URL(storageOrigin).origin;
    return (
      parsed.protocol === "https:" &&
      parsed.origin === origin &&
      parsed.pathname.startsWith("/storage/v1/object/sign/attachments/")
    );
  } catch {
    return false;
  }
}

/**
 * One turn of the conversation. The text ceiling is a whole pasted essay or
 * a screen of code, not a question; an empty message is allowed when it
 * carries files ("what is this?" is implied by a photo on its own).
 */
export const CompassMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(16_000),
    /** No small cap: with Storage URLs each one is a hundred bytes. */
    attachments: z.array(WireAttachmentSchema).max(60).optional(),
  })
  .refine((m) => m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0, {
    message: "A message needs text or a file.",
    path: ["content"],
  });

/**
 * The snapshot is data the client already holds, so unknown keys pass through
 * rather than failing the request on every schema change. Shapes and sizes are
 * still enforced.
 */
export const CompassSnapshotSchema = z
  .object({
    now: z.string().min(4),
    timezone: z.string().max(64),
    profile: z.object({
      name: z.string().max(80),
      grade: z.string().max(40),
      school: z.string().max(120),
      city: z.string().max(80),
    }),
    schoolDay: z.object({
      isSchoolDay: z.boolean(),
      reason: z.string().max(200),
      nextClass: z.string().max(200).optional(),
    }),
    availableMin: z.number().min(0).max(1440),
    tasks: z.array(z.record(z.unknown())).max(120),
    assignments: z.array(z.record(z.unknown())).max(120),
    events: z.array(z.record(z.unknown())).max(160),
    notes: z.array(z.record(z.unknown())).max(80),
    inbox: z.array(z.record(z.unknown())).max(80).optional(),
    courses: z.array(z.string().max(120)).max(20),
    isDemo: z.boolean(),
  })
  .passthrough();

export const CompassRequestSchema = z
  .object({
    messages: z.array(CompassMessageSchema).min(1).max(40),
    snapshot: CompassSnapshotSchema,
    clientId: z.string().min(8).max(64),
  })
  // Demo mode's data URLs share the host's 4.5 MB body limit; this fails
  // with a sentence instead of a bare 413.
  .refine(
    (r) =>
      r.messages.reduce(
        (n, m) =>
          n +
          (m.attachments ?? []).reduce(
            (k, a) => k + (a.url.startsWith("data:") ? a.url.length : 0),
            0,
          ),
        0,
      ) <= 4_000_000,
    { message: "Those files are too large to send together.", path: ["messages"] },
  );

/**
 * Capture accepts a whole pasted email, not just a typed line, so the ceiling
 * is generous — but still a ceiling, because the body is billed by the token.
 */
export const CaptureRequestSchema = z
  .object({
    /** Optional when images are attached: a photo alone is enough to file. */
    text: z.string().max(8000).default(""),
    /** Up to four images. Vercel caps a request body at 4.5 MB, so the total is capped too. */
    images: z.array(ImageDataUrlSchema).max(4).default([]),
    courses: z.array(z.string().max(120)).max(20).default([]),
    /** "Class — Teacher" pairs, so "Robson wants…" resolves to English 9 H. */
    teachers: z.array(z.string().max(160)).max(20).default([]),
    timezone: z.string().max(64).default("America/Los_Angeles"),
    clientId: z.string().min(8).max(64),
  })
  .refine((v) => v.text.trim().length >= 2 || v.images.length > 0, {
    message: "Type something or attach an image.",
    path: ["text"],
  })
  .refine((v) => v.images.reduce((n, i) => n + i.length, 0) <= 4_000_000, {
    message: "Images are too large together. Attach fewer or smaller ones.",
    path: ["images"],
  });

/** One item the model filed. Re-validated here before it can reach the UI. */
export const CapturedItemSchema = z.object({
  kind: z.enum(["task", "event", "note"]),
  title: z.string().min(1).max(240),
  description: z.string().max(2000).nullish(),
  courseName: z.string().max(120).nullish(),
  location: z.string().max(200).nullish(),
  dueAt: z.string().max(40).nullish(),
  startAt: z.string().max(40).nullish(),
  endAt: z.string().max(40).nullish(),
  allDay: z.boolean().default(false),
  category: z.enum(["school", "work", "personal"]).default("school"),
  priority: z.enum(["urgent", "high", "normal", "low"]).default("normal"),
  /**
   * Zero is allowed, and that is the point: a note takes no time, and the
   * model correctly returns 0 for one. Requiring 5 here silently deleted every
   * note the capture box produced — the schema rejected the item and the
   * caller filtered it out without a word. Tasks are clamped to a sensible
   * floor where they are created instead.
   */
  estimateMin: z.number().int().min(0).max(600).default(30),
  noteKind: z.enum(["thought", "idea"]).nullish(),
  evidence: z.string().max(600).nullish(),
});

export const SyncRequestSchema = z.object({
  providers: z.array(z.enum(SYNCABLE)).min(1).max(SYNCABLE.length),
  userId: z.string().min(1).max(64),
});

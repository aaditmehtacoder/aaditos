/**
 * Request schemas for every API route.
 *
 * Kept in one module so the routes and the tests validate against exactly the
 * same definitions. Sizes are capped so a hostile caller cannot inflate token
 * usage or memory through an oversized payload.
 */

import { z } from "zod";

import { SYNCABLE } from "@/lib/integrations/contracts";

export const CompassMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
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

export const CompassRequestSchema = z.object({
  messages: z.array(CompassMessageSchema).min(1).max(24),
  snapshot: CompassSnapshotSchema,
  clientId: z.string().min(8).max(64),
});

/**
 * Capture accepts a whole pasted email, not just a typed line, so the ceiling
 * is generous — but still a ceiling, because the body is billed by the token.
 */
/** A data URL for one image: png, jpeg, webp or gif, at most ~1.6 MB encoded. */
export const ImageDataUrlSchema = z
  .string()
  .max(1_700_000)
  .regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/, "Not an image data URL");

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

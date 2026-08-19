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
export const CaptureRequestSchema = z.object({
  text: z.string().min(2).max(8000),
  courses: z.array(z.string().max(120)).max(20).default([]),
  /** "Class — Teacher" pairs, so "Robson wants…" resolves to English 9 H. */
  teachers: z.array(z.string().max(160)).max(20).default([]),
  timezone: z.string().max(64).default("America/Los_Angeles"),
  clientId: z.string().min(8).max(64),
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

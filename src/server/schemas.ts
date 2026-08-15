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
    projects: z.array(z.record(z.unknown())).max(40),
    opportunities: z.array(z.record(z.unknown())).max(60),
    focus: z.record(z.unknown()),
    courses: z.array(z.string().max(120)).max(20),
    isDemo: z.boolean(),
  })
  .passthrough();

export const CompassRequestSchema = z.object({
  messages: z.array(CompassMessageSchema).min(1).max(24),
  snapshot: CompassSnapshotSchema,
  tone: z.enum(["concise", "coach", "detailed"]).default("concise"),
  clientId: z.string().min(8).max(64),
});

export const CompassTaskRequestSchema = z.object({
  text: z.string().min(2).max(1000),
  courses: z.array(z.string().max(120)).max(20).default([]),
  projects: z.array(z.string().max(120)).max(20).default([]),
  timezone: z.string().max(64).default("America/Los_Angeles"),
  clientId: z.string().min(8).max(64),
});

export const SyncRequestSchema = z.object({
  providers: z.array(z.enum(SYNCABLE)).min(1).max(SYNCABLE.length),
  userId: z.string().min(1).max(64),
  githubRepos: z.array(z.string().max(140)).max(12).default([]),
});

export const SpotifyControlSchema = z.object({
  action: z.enum(["play", "pause", "next", "previous"]),
});

/**
 * Wire contracts shared by the browser and the server routes.
 *
 * This module is deliberately free of any server-only import so the client
 * bundle can reference these shapes without dragging a token-reading module
 * along with it. The adapters under `src/server/providers` implement them.
 */

import type { Assignment, CalendarEvent, Course } from "@/lib/core/types";

export const SYNCABLE = [
  "wilcox",
  "google",
  "weather",
  "gmail",
  "github",
  "slack",
  "notion",
  "aeries",
] as const;
export type SyncProvider = (typeof SYNCABLE)[number];

/**
 * Providers that need no interactive consent and are safe to run on a timer.
 * Google and Gmail depend on a consent that can lapse, and an unattended retry
 * against a lapsed consent is a stream of identical errors — so they only run
 * when a person presses Sync.
 */
export const AUTO_SYNCABLE: SyncProvider[] = [
  "wilcox",
  "weather",
  "github",
  "slack",
  "notion",
  "aeries",
];

/** Everything, for the Sync button. */
export const ALL_SYNCABLE: SyncProvider[] = [...SYNCABLE];

/**
 * Sync provider → the integration record id that carries its persisted status.
 * Not identity: the single `google` sync writes a `google_calendar` record.
 */
export const PROVIDER_INTEGRATION_IDS: Record<SyncProvider, string> = {
  wilcox: "wilcox",
  google: "google_calendar",
  weather: "weather",
  gmail: "gmail",
  github: "github",
  slack: "slack",
  notion: "notion",
  aeries: "aeries",
};

/** Booleans only — never a key, token or secret. */
export interface ProviderCapabilities {
  openai: boolean;
  openaiModel: string;
  /** The fallback ladder, primary first. */
  openaiModels: string[];
  /** How many API keys are configured (1 = no spare). */
  openaiKeys: number;
  google: boolean;
  supabase: boolean;
  cron: boolean;
  github: boolean;
  slack: boolean;
  notion: boolean;
  aeries: boolean;
  wilcox: true;
  weather: true;
}

/**
 * Something from outside that might need action: an email, a Slack mention,
 * a GitHub issue, a Notion page. The Inbox shows these with their source's
 * mark; one click files the text through capture, which decides what it is.
 */
export interface InboxItem {
  /** Stable across syncs, so a dismissed item stays dismissed. */
  id: string;
  source: "gmail" | "github" | "slack" | "notion";
  title: string;
  /** Snippet, body preview, or the page's parent. */
  detail?: string | undefined;
  /** Sender, author, or workspace. */
  from?: string | undefined;
  url?: string | undefined;
  /** ISO instant the item was created or last changed. */
  at: string;
}

export interface AeriesResult {
  configured: boolean;
  ok: boolean;
  courses: Course[];
  assignments: Assignment[];
  fetchedAt?: string;
  error?: string;
}

export interface WeatherResult {
  ok: boolean;
  tempF?: number;
  highF?: number;
  lowF?: number;
  condition?: string;
  /** WMO interpretation code — what decides which icon is drawn. */
  code?: number;
  /** False after sunset, so a clear sky draws a moon rather than a sun. */
  isDay?: boolean;
  fetchedAt?: string;
  error?: string;
}

export interface SyncRunResult {
  provider: SyncProvider;
  ok: boolean;
  imported: number;
  updated: number;
  skipped: number;
  message: string;
  startedAt: string;
  finishedAt: string;
  /** True when the provider is simply not configured — not an error. */
  needsCredentials: boolean;
}

export interface GoogleResult {
  configured: boolean;
  /** True once a refresh token is held in the sealed session cookie. */
  connected: boolean;
  ok: boolean;
  events: RawGoogleEvent[];
  courses: Course[];
  assignments: Assignment[];
  fetchedAt?: string;
  error?: string;
}

/** Mirrors `RawEvent` from core/normalize without importing that module. */
export interface RawGoogleEvent {
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  startAt: string;
  endAt?: string | undefined;
  allDay: boolean;
  kind: string;
  source: string;
  calendarId: string;
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
}

export interface GoogleStatus {
  configured: boolean;
  encryptionReady: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  scopes: string[];
  /**
   * Scopes this app now asks for that the stored token was never granted. A
   * token issued before a scope was added keeps working for everything it
   * already covered and fails only on the new capability, so this is what
   * distinguishes "needs reconnecting" from "broken".
   */
  missingScopes: string[];
  /** True once the stored consent includes read-only Gmail. */
  gmail: boolean;
}

export interface SyncPayload {
  runs: SyncRunResult[];
  wilcox?: { events: CalendarEvent[]; calendarIds: string[]; duplicatesRemoved: number };
  google?: GoogleResult;
  weather?: WeatherResult;
  aeries?: AeriesResult;
  /** Merged from every inbox-producing provider, newest first. */
  inbox?: InboxItem[];
}

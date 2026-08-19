/**
 * Wire contracts shared by the browser and the server routes.
 *
 * This module is deliberately free of any server-only import so the client
 * bundle can reference these shapes without dragging a token-reading module
 * along with it. The adapters under `src/server/providers` implement them.
 */

import type { Assignment, CalendarEvent, Course } from "@/lib/core/types";

export const SYNCABLE = ["wilcox", "google", "weather"] as const;
export type SyncProvider = (typeof SYNCABLE)[number];

/**
 * Sync provider → the integration record id that carries its persisted status.
 * Not identity: the single `google` sync writes a `google_calendar` record.
 */
export const PROVIDER_INTEGRATION_IDS: Record<SyncProvider, string> = {
  wilcox: "wilcox",
  google: "google_calendar",
  weather: "weather",
};

/** Booleans only — never a key, token or secret. */
export interface ProviderCapabilities {
  openai: boolean;
  openaiModel: string;
  google: boolean;
  supabase: boolean;
  cron: boolean;
  wilcox: true;
  weather: true;
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
}

export interface SyncPayload {
  runs: SyncRunResult[];
  wilcox?: { events: CalendarEvent[]; calendarIds: string[]; duplicatesRemoved: number };
  google?: GoogleResult;
  weather?: WeatherResult;
}

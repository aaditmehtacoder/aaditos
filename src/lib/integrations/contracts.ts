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
  "aeries",
  "github",
  "vercel",
  "spotify",
  "weather",
] as const;
export type SyncProvider = (typeof SYNCABLE)[number];

/**
 * Sync provider → the integration record id that carries its persisted status.
 * Not identity: the single `google` sync writes a `google_calendar` record.
 */
export const PROVIDER_INTEGRATION_IDS: Record<SyncProvider, string> = {
  wilcox: "wilcox",
  google: "google_calendar",
  aeries: "aeries",
  github: "github",
  vercel: "vercel",
  spotify: "spotify",
  weather: "weather",
};

/** Booleans only — never a key, token or secret. */
export interface ProviderCapabilities {
  openai: boolean;
  openaiModel: string;
  github: boolean;
  vercel: boolean;
  spotify: boolean;
  google: boolean;
  supabase: boolean;
  cron: boolean;
  aeries: boolean;
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

export interface GithubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  url: string;
  logsUrl: string;
  updatedAt: string;
}

export interface GithubRepoSummary {
  repo: string;
  openIssues: number;
  openPullRequests: number;
  lastCommit?: { message: string; url: string; at: string; author: string } | undefined;
  failedRuns: GithubWorkflowRun[];
  recentRuns: GithubWorkflowRun[];
  error?: string | undefined;
}

/**
 * One issue or pull request assigned to the token owner. Sourced from
 * `GET /issues?filter=assigned`, which spans every repository the token can
 * see — personal, collaborator and organization — not just linked projects.
 */
export interface GithubAssignedItem {
  id: number;
  repo: string;
  number: number;
  title: string;
  url: string;
  isPullRequest: boolean;
  draft: boolean;
  labels: string[];
  updatedAt: string;
  commentCount: number;
}

export interface GithubResult {
  configured: boolean;
  ok: boolean;
  repos: GithubRepoSummary[];
  /** Assigned across all visible repos. Empty when nothing is assigned. */
  assigned: GithubAssignedItem[];
  /** Set when the assigned lookup specifically failed; repos may still be ok. */
  assignedError?: string | undefined;
  fetchedAt?: string;
  error?: string;
}

export interface VercelDeployment {
  id: string;
  project: string;
  state: string;
  target: string;
  url: string;
  branch?: string | undefined;
  framework?: string | undefined;
  createdAt: string;
}

export interface VercelResult {
  configured: boolean;
  ok: boolean;
  deployments: VercelDeployment[];
  projects: Array<{ name: string; framework?: string | undefined }>;
  fetchedAt?: string;
  error?: string;
}

export interface SpotifyTrack {
  title: string;
  artist: string;
  album?: string | undefined;
  url?: string | undefined;
  imageUrl?: string | undefined;
  isPlaying: boolean;
  progressMs?: number | undefined;
  durationMs?: number | undefined;
  device?: string | undefined;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  trackCount: number;
  url: string;
}

export interface SpotifyResult {
  configured: boolean;
  ok: boolean;
  premium?: boolean | undefined;
  nowPlaying?: SpotifyTrack | undefined;
  recent: SpotifyTrack[];
  playlists: SpotifyPlaylist[];
  fetchedAt?: string;
  error?: string;
  /** Set when the account's Spotify plan blocks playback control. */
  controlUnavailableReason?: string | undefined;
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

/** One message, reduced to the plain text an extractor actually needs. */
export interface InboxMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  /** RFC-2822 date as an ISO instant, so relative dates in the body resolve correctly. */
  receivedAt: string;
  snippet: string;
  /** text/plain body, HTML stripped, capped. Never attachments. */
  body: string;
  externalUrl: string;
}

export interface GmailResult {
  configured: boolean;
  connected: boolean;
  ok: boolean;
  /** The exact query that produced these messages, shown in the UI verbatim. */
  query: string;
  messages: InboxMessage[];
  fetchedAt?: string;
  error?: string;
}

/**
 * One item an email yielded. `kind` decides where it lands: an `event` has a
 * start instant and can be pushed to Google Calendar; a `task` is something to
 * do by a deadline.
 */
export interface ExtractedItem {
  kind: "event" | "task";
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  startAt?: string | undefined;
  endAt?: string | undefined;
  allDay: boolean;
  dueAt?: string | undefined;
  category: "school" | "work" | "personal";
  priority: "urgent" | "high" | "normal" | "low";
  estimateMin: number;
  /** Quoted from the source so a wrong date is traceable to the sentence behind it. */
  evidence?: string | undefined;
}

export interface ExtractionResult {
  ok: boolean;
  items: ExtractedItem[];
  /** Set when the email genuinely contained nothing actionable. */
  note?: string | undefined;
  code?: string | undefined;
  message?: string | undefined;
}

export interface CalendarWriteResult {
  ok: boolean;
  eventId?: string | undefined;
  htmlLink?: string | undefined;
  message: string;
  code?: string | undefined;
}

export interface AeriesResult {
  configured: boolean;
  ok: boolean;
  courses: Course[];
  assignments: Assignment[];
  grades: Array<{ courseName: string; grade: string; percent?: number }>;
  fetchedAt?: string;
  error?: string;
}

export interface SyncPayload {
  runs: SyncRunResult[];
  wilcox?: { events: CalendarEvent[]; calendarIds: string[]; duplicatesRemoved: number };
  aeries?: AeriesResult;
  google?: GoogleResult;
  github?: GithubResult;
  vercel?: VercelResult;
  spotify?: SpotifyResult;
  weather?: WeatherResult;
}

export interface PlaybackResult {
  ok: boolean;
  message: string;
  code?: string;
}

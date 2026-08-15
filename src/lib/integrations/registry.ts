/**
 * Provider registry.
 *
 * One description per provider covering what it does, what it needs, and — most
 * importantly — what it genuinely *cannot* do. The Integrations page renders
 * this verbatim, so a provider is never shown as "connected" unless a real
 * request to it succeeded.
 */

import type { IntegrationStatus } from "@/lib/core/types";
import type { SyncProvider } from "@/lib/integrations/contracts";

export type Availability =
  | "implemented" // works right now, no credentials needed
  | "needs_credentials" // fully implemented, waiting on env vars
  | "restricted" // the provider's API does not allow what people expect
  | "manual"; // no usable API — manual capture / links only

export interface ProviderDescriptor {
  id: string;
  name: string;
  glyph: string;
  description: string;
  availability: Availability;
  /** Which sync provider (if any) backs this entry. */
  sync?: SyncProvider | undefined;
  /** Env var names required on the server. Never values. */
  envVars: string[];
  /** Human-readable permission scopes requested. */
  permissions: string[];
  /** Honest statement of limits. Always rendered when present. */
  limitation?: string | undefined;
  docsUrl?: string | undefined;
  /** Capability key returned by `/api/config`. */
  capabilityKey?: string | undefined;
  /** Providers that need a browser consent round trip before they can sync. */
  oauth?: "google" | undefined;
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: "wilcox",
    name: "Wilcox calendars",
    glyph: "W",
    description:
      "School, district, athletics and counseling calendars, normalized and deduplicated into one feed.",
    availability: "implemented",
    sync: "wilcox",
    envVars: [],
    permissions: ["Read public school calendar pages"],
    limitation:
      "Santa Clara USD publishes no ICS or RSS feed, so this reads the school's public calendar pages through a typed server-side adapter. Only public information is read; nothing is sent to the school.",
    docsUrl: "https://wilcox.santaclarausd.org/about/calendar",
    capabilityKey: "wilcox",
  },
  {
    id: "aeries",
    name: "Aeries (official gradebook)",
    glyph: "AE",
    description:
      "Class schedule, gradebook assignments and official course grades from the district's student information system.",
    availability: "restricted",
    sync: "aeries",
    envVars: ["AERIES_BASE_URL", "AERIES_CERT", "AERIES_STUDENT_ID", "AERIES_SCHOOL_CODE"],
    permissions: ["Read your own classes, gradebook assignments and grades"],
    limitation:
      "Aeries has no central API — each district hosts its own, and access needs an API certificate issued by a district Aeries administrator. Districts do not normally issue one to a student, so this usually cannot be enabled without the district's help. Endpoint paths also differ between Aeries versions and can be overridden with AERIES_PATH_* variables.",
    docsUrl: "https://support.aeries.com/support/solutions/folders/14000119199",
    capabilityKey: "aeries",
  },
  {
    id: "weather",
    name: "Santa Clara weather",
    glyph: "☀",
    description: "Current conditions and today's high and low for the Today page.",
    availability: "implemented",
    sync: "weather",
    envVars: [],
    permissions: ["Read public forecast data"],
    docsUrl: "https://open-meteo.com",
    capabilityKey: "weather",
  },
  {
    id: "github",
    name: "GitHub",
    glyph: "GH",
    description:
      "Open issues, pull requests, latest commit and GitHub Actions runs for the repositories linked to your projects.",
    availability: "needs_credentials",
    sync: "github",
    envVars: ["GITHUB_TOKEN"],
    permissions: ["Read repository metadata", "Read issues and pull requests", "Read Actions runs"],
    limitation:
      "Read-only by design. AaditOS will not rerun a workflow, merge a pull request, or push code.",
    docsUrl: "https://github.com/settings/tokens",
    capabilityKey: "github",
  },
  {
    id: "vercel",
    name: "Vercel",
    glyph: "▲",
    description:
      "Production and preview deployment status, failed builds, deployment URLs and branch metadata.",
    availability: "needs_credentials",
    sync: "vercel",
    envVars: ["VERCEL_TOKEN", "VERCEL_TEAM_ID"],
    permissions: ["Read deployments", "Read projects"],
    limitation: "Read-only. Redeploys and rollbacks are not performed from AaditOS.",
    docsUrl: "https://vercel.com/account/tokens",
    capabilityKey: "vercel",
  },
  {
    id: "spotify",
    name: "Spotify",
    glyph: "S",
    description:
      "Now playing, recently played, your playlists, and a focus playlist you pick for focus sessions.",
    availability: "needs_credentials",
    sync: "spotify",
    envVars: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"],
    permissions: [
      "user-read-playback-state",
      "user-read-currently-playing",
      "user-read-recently-played",
      "playlist-read-private",
      "user-modify-playback-state (control only)",
    ],
    limitation:
      "Spotify only allows playback control on Premium accounts. On a free account the controls are disabled and labelled.",
    docsUrl: "https://developer.spotify.com/dashboard",
    capabilityKey: "spotify",
  },
  {
    id: "openai",
    name: "OpenAI (Compass)",
    glyph: "◎",
    description:
      "Powers Compass through the Responses API with streaming, strict-schema tools and no retention.",
    availability: "needs_credentials",
    envVars: ["OPENAI_API_KEY", "OPENAI_MODEL"],
    permissions: ["Send your prompt and a workspace summary for the current question"],
    limitation:
      "Requests use store: false, so OpenAI retains nothing. Only usage counts are logged — never prompt content.",
    docsUrl: "https://platform.openai.com/api-keys",
    capabilityKey: "openai",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    glyph: "GC",
    description:
      "Personal and family events merged into Today and the school calendar — and the one place AaditOS writes: a confirmed event is added to your primary calendar.",
    availability: "needs_credentials",
    sync: "google",
    oauth: "google",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"],
    permissions: [
      "calendar.readonly — read events on your calendars",
      "calendar.events — add an event you confirm (cannot delete or share a calendar)",
    ],
    limitation:
      "This is the only write in AaditOS, and it only runs when you press Confirm — never from a sync, a scheduled job, or Compass. Needs a Google Cloud OAuth client with the Calendar API enabled and this app's redirect URI registered. The refresh token is kept in a sealed, httpOnly cookie encrypted with TOKEN_ENCRYPTION_KEY. Three things outside this app can block consent, and each fails differently: a school-managed Workspace account may forbid third-party OAuth entirely; a supervised Family Link account diverts to a parent who must approve; and while the OAuth app is in Testing, only accounts on its test-user list are allowed at all. In every case the rest of AaditOS keeps working, and the Inbox page still turns a pasted email into tasks and events with no Google connection.",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    capabilityKey: "google",
  },
  {
    id: "google_classroom",
    name: "Google Classroom",
    glyph: "GK",
    description: "Courses, published coursework, due dates and your own submission state.",
    availability: "needs_credentials",
    sync: "google",
    oauth: "google",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"],
    permissions: [
      "classroom.courses.readonly",
      "classroom.coursework.me.readonly",
      "classroom.student-submissions.me.readonly",
    ],
    limitation:
      "Read-only, and only your own submissions — the Classroom API never exposes other students' work. Santa Clara USD may restrict third-party apps on student accounts; that restriction is enforced by Google, not by AaditOS.",
    docsUrl: "https://developers.google.com/classroom/guides/auth",
    capabilityKey: "google",
  },
  {
    id: "gmail",
    name: "Gmail",
    glyph: "M",
    description:
      "Reads club and school announcements from a narrow search and turns them into dated tasks and events on the Inbox page — never a full mailbox scan.",
    availability: "needs_credentials",
    oauth: "google",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"],
    permissions: ["gmail.readonly — only messages matching the configured search"],
    limitation:
      "Read-only: nothing is sent, replied to, labelled or deleted, and attachments are never downloaded. The search query is the real boundary — only mail matching it is ever read. gmail.readonly is a Google restricted scope, so a personal project can use it for its own account, but publishing it to other users requires a CASA assessment. If your school blocks the Gmail API, the Inbox page still works by pasting an email in.",
    docsUrl: "https://developers.google.com/gmail/api/auth/scopes",
    capabilityKey: "google",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    glyph: "D",
    description: "Links project documents and assignment drafts you explicitly attach.",
    availability: "needs_credentials",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    permissions: ["drive.file — only files you pick"],
    limitation: "Uses the drive.file scope, which can only see files you explicitly choose.",
    docsUrl: "https://developers.google.com/drive/api/guides/api-specific-auth",
    capabilityKey: "google",
  },
  {
    id: "discord",
    name: "Discord",
    glyph: "DC",
    description:
      "Standup reminders and mentions via an incoming webhook you create in your own server.",
    availability: "manual",
    envVars: [],
    permissions: [],
    limitation:
      "Discord's API does not give third-party apps access to your personal DMs or servers you are only a member of. Self-bots are against Discord's terms. Use a server webhook, or capture items manually.",
    docsUrl: "https://discord.com/developers/docs/resources/webhook",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    glyph: "in",
    description: "Opportunity contacts and follow-up reminders, captured manually.",
    availability: "manual",
    envVars: [],
    permissions: [],
    limitation:
      "LinkedIn's public API does not expose connections, messages or your feed to third-party apps. Add opportunities by hand or paste a profile URL; nothing is scraped.",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
  },
];

export function providerById(id: string): ProviderDescriptor | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  implemented: "Ready",
  needs_credentials: "Needs credentials",
  restricted: "Restricted by provider",
  manual: "Manual capture only",
};

export function statusLabel(status: IntegrationStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "error":
      return "Error";
    case "unavailable":
      return "Unavailable";
    case "demo":
      return "Demo data";
    default:
      return "Not connected";
  }
}

export function statusTone(
  status: IntegrationStatus,
): "success" | "urgent" | "warning" | "neutral" | "primary" {
  switch (status) {
    case "connected":
      return "success";
    case "error":
      return "urgent";
    case "unavailable":
      return "warning";
    case "demo":
      return "primary";
    default:
      return "neutral";
  }
}

/**
 * Google adapter — Calendar, Classroom and Gmail.
 *
 * The OAuth refresh token is the only long-lived secret here. It is stored in a
 * sealed, httpOnly session cookie encrypted with `TOKEN_ENCRYPTION_KEY`, so it
 * never reaches JavaScript and no database is required. Without that key the
 * connect flow refuses to start rather than storing a token in the clear.
 *
 * Everything reads, with exactly one exception: `createCalendarEvent` adds an
 * event to the primary calendar, and only ever from a confirmation the user
 * clicked. Nothing here deletes anything, and nothing sends mail.
 */

import type { RawEvent } from "@/lib/core/normalize";
import { stableId } from "@/lib/core/ids";
import type { CalendarWriteResult, GoogleResult, GoogleStatus } from "@/lib/integrations/contracts";
import type { Assignment, Course, ISODateTime } from "@/lib/core/types";

import { serverEnv } from "../env";

export type { CalendarWriteResult, GoogleResult, GoogleStatus };

/**
 * Scopes, and exactly why each one is here.
 *
 * `calendar.events` is the only scope that can write, and it is deliberately
 * narrower than `calendar`: it can create and update events but cannot create,
 * delete or share a calendar. Everything else is readonly. Gmail is readonly
 * and further narrowed by the search query in providers/gmail.ts.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];

/** The scope a given capability needs, for honest "reconnect to enable" messages. */
export const SCOPE_FOR = {
  calendarWrite: "https://www.googleapis.com/auth/calendar.events",
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
} as const;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function googleConfigured(): boolean {
  return Boolean(serverEnv.googleClientId && serverEnv.googleClientSecret);
}

export function buildConsentUrl(opts: { redirectUri: string; state: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", serverEnv.googleClientId ?? "");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  // offline + consent is what actually returns a refresh token.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export interface TokenExchange {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
  email?: string | undefined;
}

export async function exchangeCode(opts: {
  code: string;
  redirectUri: string;
}): Promise<TokenExchange> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: serverEnv.googleClientId ?? "",
      client_secret: serverEnv.googleClientSecret ?? "",
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(12_000),
  });

  const data = (await response.json()) as {
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || data.error) {
    throw new Error(
      data.error_description ?? data.error ?? `Google token exchange failed (${response.status})`,
    );
  }
  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove AaditOS at myaccount.google.com/permissions and connect again.",
    );
  }

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token ?? "",
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? "",
    email: emailFromIdToken(data.id_token),
  };
}

/** Reads the `email` claim without verifying — used only for display. */
function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      email?: string;
    };
    return json.email;
  } catch {
    return undefined;
  }
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: serverEnv.googleClientId ?? "",
      client_secret: serverEnv.googleClientSecret ?? "",
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(12_000),
  });

  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    // `invalid_grant` means the user revoked access or the token expired.
    throw new Error(
      data.error === "invalid_grant"
        ? "Google access was revoked or expired. Reconnect Google in Integrations."
        : (data.error_description ?? "Could not refresh the Google access token."),
    );
  }
  return data.access_token;
}

async function api<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(path, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 403) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      body.error?.message?.includes("disabled")
        ? "Your school's Google Workspace administrator has blocked third-party access to this API."
        : (body.error?.message ?? "Google denied the request (403)."),
    );
  }
  if (!response.ok) throw new Error(`Google API returned ${response.status}`);
  return (await response.json()) as T;
}

// ---- normalizers (pure, tested) -----------------------------------------

interface GoogleEventRow {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/** Google Calendar events → the shared RawEvent shape. */
export function normalizeGoogleEvents(rows: unknown, calendarId: string): RawEvent[] {
  if (!Array.isArray(rows)) return [];
  const out: RawEvent[] = [];

  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as GoogleEventRow;
    if (row.status === "cancelled") continue;

    const title = row.summary?.trim();
    if (!title) continue;

    // `date` means all-day; `dateTime` is a real instant.
    const allDay = Boolean(row.start?.date && !row.start?.dateTime);
    const rawStart = row.start?.dateTime ?? row.start?.date;
    if (!rawStart) continue;

    // An all-day `date` is a floating calendar day; anchor it to Pacific local
    // midnight so it lands on the right day rather than shifting via UTC.
    const startAt = allDay ? `${rawStart}T00:00:00-07:00` : rawStart;
    if (Number.isNaN(new Date(startAt).getTime())) continue;

    const rawEnd = row.end?.dateTime;
    const endAt = rawEnd && !Number.isNaN(new Date(rawEnd).getTime()) ? rawEnd : undefined;

    out.push({
      title,
      description: row.description?.trim() || undefined,
      location: row.location?.trim() || undefined,
      startAt: new Date(startAt).toISOString(),
      endAt: endAt ? new Date(endAt).toISOString() : undefined,
      allDay,
      kind: "personal",
      source: "google_calendar",
      calendarId,
      sourceRef: row.id,
      externalUrl: row.htmlLink,
    });
  }

  return out;
}

interface ClassroomCourseRow {
  id?: string;
  name?: string;
  section?: string;
  room?: string;
  courseState?: string;
  alternateLink?: string;
  descriptionHeading?: string;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function normalizeClassroomCourses(
  rows: unknown,
  userId: string,
  now: ISODateTime,
): Course[] {
  if (!Array.isArray(rows)) return [];
  const out: Course[] = [];

  rows.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as ClassroomCourseRow;
    const name = row.name?.trim();
    if (!name || !row.id) return;
    // ARCHIVED and PROVISIONED courses are not this term's classes.
    if (row.courseState && row.courseState !== "ACTIVE") return;

    out.push({
      id: stableId(`${userId}:google:course:${row.id}`),
      userId,
      name,
      teacher: undefined,
      room: row.room?.trim() || undefined,
      period: undefined,
      color: PALETTE[index % PALETTE.length] ?? "var(--chart-1)",
      grade: undefined,
      source: "google_classroom",
      sourceRef: `google:course:${row.id}`,
      externalUrl: row.alternateLink,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  return out;
}

interface CourseWorkRow {
  id?: string;
  courseId?: string;
  title?: string;
  description?: string;
  alternateLink?: string;
  maxPoints?: number;
  state?: string;
  workType?: string;
  dueDate?: { year?: number; month?: number; day?: number };
  dueTime?: { hours?: number; minutes?: number };
}

interface SubmissionRow {
  courseWorkId?: string;
  state?: string;
  late?: boolean;
  assignedGrade?: number;
}

/** Combines coursework with the student's own submission state. */
export function normalizeClassroomWork(
  work: unknown,
  submissions: unknown,
  opts: {
    userId: string;
    now: ISODateTime;
    courseIdFor: (googleCourseId: string) => string | undefined;
  },
): Assignment[] {
  if (!Array.isArray(work)) return [];

  const submissionByWork = new Map<string, SubmissionRow>();
  if (Array.isArray(submissions)) {
    for (const entry of submissions) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as SubmissionRow;
      if (row.courseWorkId) submissionByWork.set(row.courseWorkId, row);
    }
  }

  const out: Assignment[] = [];

  for (const entry of work) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as CourseWorkRow;
    const title = row.title?.trim();
    if (!title || !row.id) continue;
    // Only published coursework is real work for the student.
    if (row.state && row.state !== "PUBLISHED") continue;

    const submission = submissionByWork.get(row.id);
    const graded = typeof submission?.assignedGrade === "number";
    const state: Assignment["state"] = graded
      ? "graded"
      : submission?.state === "TURNED_IN" || submission?.state === "RETURNED"
        ? "submitted"
        : submission?.late
          ? "missing"
          : "assigned";

    const dueAt = classroomDueInstant(row.dueDate, row.dueTime);
    const ref = `google:coursework:${row.id}`;

    out.push({
      id: stableId(`${opts.userId}:${ref}`),
      userId: opts.userId,
      courseId: row.courseId ? opts.courseIdFor(row.courseId) : undefined,
      title,
      description: row.description?.trim() || undefined,
      dueAt,
      // Classroom omits dueTime for whole-day deadlines.
      dueAllDay: Boolean(row.dueDate && !row.dueTime),
      state,
      estimateMin: estimateFromPoints(row.maxPoints),
      points: row.maxPoints,
      grade:
        graded && typeof row.maxPoints === "number"
          ? `${submission!.assignedGrade}/${row.maxPoints}`
          : undefined,
      source: "google_classroom",
      sourceRef: ref,
      externalUrl: row.alternateLink,
      createdAt: opts.now,
      updatedAt: opts.now,
    });
  }

  return out;
}

/** Classroom sends UTC date and time as separate, partial objects. */
export function classroomDueInstant(
  dueDate?: CourseWorkRow["dueDate"],
  dueTime?: CourseWorkRow["dueTime"],
): ISODateTime | undefined {
  if (!dueDate?.year || !dueDate.month || !dueDate.day) return undefined;
  const instant = Date.UTC(
    dueDate.year,
    dueDate.month - 1,
    dueDate.day,
    dueTime?.hours ?? 23,
    dueTime?.minutes ?? 59,
  );
  return Number.isNaN(instant) ? undefined : new Date(instant).toISOString();
}

export function estimateFromPoints(points: number | undefined): number {
  if (points === undefined || points <= 0) return 30;
  if (points <= 10) return 20;
  if (points <= 25) return 35;
  if (points <= 50) return 50;
  if (points <= 100) return 75;
  return 90;
}

// ---- write ---------------------------------------------------------------

export interface CalendarEventInput {
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  /** ISO instant. Required. */
  startAt: string;
  /** ISO instant. Defaults to one hour after start for timed events. */
  endAt?: string | undefined;
  allDay?: boolean | undefined;
  timezone?: string | undefined;
}

/**
 * Creates one event on the user's primary calendar.
 *
 * This is the only write in AaditOS, and it only ever runs from an explicit
 * confirmation in the UI — never from a sync, a cron run, or a model tool call.
 * An all-day event uses Google's exclusive `end.date`, so a single-day event
 * ends on the following calendar day; getting that wrong shows the event as
 * zero-length.
 */
export async function createCalendarEvent(
  refreshToken: string,
  input: CalendarEventInput,
): Promise<CalendarWriteResult> {
  if (!googleConfigured()) {
    return {
      ok: false,
      code: "not_configured",
      message: "Google is not configured on the server.",
    };
  }

  const start = new Date(input.startAt);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, code: "bad_input", message: "That event has no valid start time." };
  }

  const timezone = input.timezone ?? "America/Los_Angeles";
  const end = input.endAt ? new Date(input.endAt) : null;
  const validEnd = end && !Number.isNaN(end.getTime()) && end > start ? end : null;

  const body: Record<string, unknown> = {
    summary: input.title.slice(0, 250),
    ...(input.description ? { description: input.description.slice(0, 4000) } : {}),
    ...(input.location ? { location: input.location.slice(0, 250) } : {}),
    ...(input.allDay
      ? {
          start: { date: calendarDate(start, timezone) },
          // Google treats end.date as exclusive.
          end: { date: calendarDate(new Date(start.getTime() + 86_400_000), timezone) },
        }
      : {
          start: { dateTime: start.toISOString(), timeZone: timezone },
          end: {
            dateTime: (validEnd ?? new Date(start.getTime() + 3_600_000)).toISOString(),
            timeZone: timezone,
          },
        }),
  };

  let accessToken: string;
  try {
    accessToken = await accessTokenFromRefresh(refreshToken);
  } catch (error) {
    return {
      ok: false,
      code: "auth",
      message: error instanceof Error ? error.message : "Could not refresh Google access.",
    };
  }

  try {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      htmlLink?: string;
      error?: { message?: string };
    };

    if (!response.ok || !data.id) {
      const message = data.error?.message ?? `Google Calendar returned ${response.status}`;
      return {
        ok: false,
        code: response.status === 403 ? "forbidden" : "api",
        message: /insufficient|scope/i.test(message)
          ? "Calendar write access was not granted. Reconnect Google in Integrations to allow adding events."
          : message,
      };
    }

    return {
      ok: true,
      eventId: data.id,
      htmlLink: data.htmlLink,
      message: `Added "${input.title}" to your Google Calendar.`,
    };
  } catch (error) {
    return {
      ok: false,
      code: "network",
      message: error instanceof Error ? error.message : "Could not reach Google Calendar.",
    };
  }
}

/** YYYY-MM-DD as seen in the given timezone, not in UTC. */
export function calendarDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  // en-CA already formats as YYYY-MM-DD.
  return parts;
}

// ---- fetch ---------------------------------------------------------------

export async function fetchGoogle(opts: {
  refreshToken: string | null;
  userId: string;
  daysAhead?: number;
}): Promise<GoogleResult> {
  if (!googleConfigured()) {
    return {
      configured: false,
      connected: false,
      ok: false,
      events: [],
      courses: [],
      assignments: [],
      error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on the server.",
    };
  }
  if (!opts.refreshToken) {
    return {
      configured: true,
      connected: false,
      ok: false,
      events: [],
      courses: [],
      assignments: [],
      error: "Google is not connected yet. Use Connect on the Integrations page.",
    };
  }

  const now = new Date().toISOString();

  let accessToken: string;
  try {
    accessToken = await accessTokenFromRefresh(opts.refreshToken);
  } catch (error) {
    return {
      configured: true,
      connected: false,
      ok: false,
      events: [],
      courses: [],
      assignments: [],
      error: error instanceof Error ? error.message : "Could not refresh Google access.",
    };
  }

  const timeMin = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + (opts.daysAhead ?? 45) * 86_400_000).toISOString();

  // Calendar and Classroom are fetched independently: a district that blocks
  // Classroom should not also cost the user their personal calendar.
  const [calendarResult, classroomResult] = await Promise.allSettled([
    api<{ items?: unknown }>(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
      accessToken,
    ),
    fetchClassroom(accessToken, opts.userId, now),
  ]);

  const events =
    calendarResult.status === "fulfilled"
      ? normalizeGoogleEvents(calendarResult.value.items, "google:primary")
      : [];
  const classroom =
    classroomResult.status === "fulfilled"
      ? classroomResult.value
      : { courses: [] as Course[], assignments: [] as Assignment[] };

  const problems: string[] = [];
  if (calendarResult.status === "rejected") {
    problems.push(`Calendar: ${errorText(calendarResult.reason)}`);
  }
  if (classroomResult.status === "rejected") {
    problems.push(`Classroom: ${errorText(classroomResult.reason)}`);
  }

  return {
    configured: true,
    connected: true,
    ok: problems.length < 2,
    events,
    courses: classroom.courses,
    assignments: classroom.assignments,
    fetchedAt: now,
    ...(problems.length > 0 ? { error: problems.join(" · ") } : {}),
  };
}

async function fetchClassroom(
  accessToken: string,
  userId: string,
  now: ISODateTime,
): Promise<{ courses: Course[]; assignments: Assignment[] }> {
  const coursePayload = await api<{ courses?: unknown }>(
    "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&studentId=me&pageSize=30",
    accessToken,
  );
  const courses = normalizeClassroomCourses(coursePayload.courses, userId, now);
  const courseIdFor = (googleId: string) =>
    courses.find((c) => c.sourceRef === `google:course:${googleId}`)?.id;

  const rawCourses = Array.isArray(coursePayload.courses)
    ? (coursePayload.courses as Array<{ id?: string }>)
    : [];

  const assignments: Assignment[] = [];
  for (const course of rawCourses.slice(0, 12)) {
    if (!course.id) continue;
    const [work, submissions] = await Promise.all([
      api<{ courseWork?: unknown }>(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=60`,
        accessToken,
      ).catch(() => ({ courseWork: [] })),
      api<{ studentSubmissions?: unknown }>(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`,
        accessToken,
      ).catch(() => ({ studentSubmissions: [] })),
    ]);

    assignments.push(
      ...normalizeClassroomWork(work.courseWork, submissions.studentSubmissions, {
        userId,
        now,
        courseIdFor,
      }),
    );
  }

  return { courses, assignments };
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "request failed";
}

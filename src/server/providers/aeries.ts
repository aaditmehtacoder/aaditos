/**
 * Aeries SIS adapter — read-only.
 *
 * Aeries is Santa Clara USD's student information system, and it is the only
 * source of the *official* gradebook. Two things about it matter:
 *
 *  1. There is no central Aeries API. Every district hosts its own instance, so
 *     `AERIES_BASE_URL` must point at the district's server.
 *  2. Authentication is an API certificate sent in the `AERIES-CERT` header,
 *     and that certificate is issued by a district Aeries administrator.
 *     Districts do not normally issue one to a student. This integration is
 *     therefore reported as *restricted*, not merely "needs credentials".
 *
 * Because the endpoint layout differs between Aeries versions and no public
 * sandbox is reachable to verify against, the paths below are overridable via
 * environment variables. The response *normalizers* — the part that turns an
 * Aeries payload into AaditOS courses, assignments and grades — are pure,
 * defensive and unit-tested.
 */

import { stableId } from "@/lib/core/ids";
import type { AeriesResult } from "@/lib/integrations/contracts";
import type { Assignment, Course, ISODateTime } from "@/lib/core/types";

import { serverEnv } from "../env";

export type { AeriesResult };

/** Default v5 paths. `{school}` and `{student}` are substituted. */
const DEFAULT_PATHS = {
  classes: "/api/v5/schools/{school}/classes/{student}",
  gradebooks: "/api/v5/schools/{school}/gradebooks/student/{student}",
  assignments: "/api/v5/schools/{school}/gradebooks/{gradebook}/assignments",
  grades: "/api/v5/schools/{school}/StudentGrades/{student}",
};

export function aeriesConfigured(): boolean {
  return Boolean(serverEnv.aeriesBaseUrl && serverEnv.aeriesCert && serverEnv.aeriesStudentId);
}

function url(path: string, replacements: Record<string, string>): string {
  const base = (serverEnv.aeriesBaseUrl ?? "").replace(/\/+$/, "");
  const filled = path.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? "");
  return `${base}${filled}`;
}

async function aeries<T>(path: string, replacements: Record<string, string>): Promise<T> {
  const cert = serverEnv.aeriesCert;
  if (!cert) throw new Error("AERIES_CERT is not configured");

  const response = await fetch(url(path, replacements), {
    headers: { "AERIES-CERT": cert, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Aeries rejected the certificate. It must be issued by the district's Aeries administrator and permit this student.",
    );
  }
  if (response.status === 404) {
    throw new Error(
      `Aeries returned 404 for ${path}. This Aeries version may use different endpoint paths — override them with AERIES_PATH_* variables.`,
    );
  }
  if (!response.ok) throw new Error(`Aeries returned ${response.status}`);

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // A district portal that is not actually an API endpoint returns HTML.
    throw new Error(
      "Aeries returned a non-JSON response. Check that AERIES_BASE_URL points at the API host, not the parent portal.",
    );
  }
}

// ---- normalizers (pure, tested) -----------------------------------------

type Raw = Record<string, unknown>;

/** Aeries payloads are inconsistently cased between versions. */
function pick(row: Raw, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
    const lower = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
    if (lower && row[lower] !== undefined && row[lower] !== null) return row[lower];
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asInstant(value: unknown): ISODateTime | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Aeries class schedule rows → AaditOS courses. */
export function normalizeAeriesClasses(rows: unknown, userId: string, now: ISODateTime): Course[] {
  if (!Array.isArray(rows)) return [];
  const out: Course[] = [];

  rows.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Raw;
    const name = asString(pick(row, "CourseName", "SectionName", "Course", "name"));
    if (!name) return;

    const sectionNumber = asString(pick(row, "SectionNumber", "SectionID", "sectionNumber"));
    const period = asNumber(pick(row, "Period", "PeriodNumber", "period"));
    const teacher = asString(pick(row, "TeacherName", "Teacher", "teacherName"));
    const room = asString(pick(row, "RoomNumber", "Room", "room"));
    const ref = sectionNumber ?? `${name}:${period ?? index}`;

    out.push({
      id: stableId(`${userId}:aeries:course:${ref}`),
      userId,
      name,
      teacher,
      room,
      period,
      color: PALETTE[index % PALETTE.length] ?? "var(--chart-1)",
      grade: undefined,
      source: "aeries",
      sourceRef: `aeries:class:${ref}`,
      externalUrl: undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  return out;
}

export interface AeriesGradebookAssignment {
  gradebookName?: string | undefined;
  raw: unknown;
}

/**
 * Aeries gradebook assignment rows → AaditOS assignments.
 *
 * `courseByName` maps an Aeries gradebook/course name to a local course id so
 * imported assignments attach to the right class.
 */
export function normalizeAeriesAssignments(
  rows: unknown,
  opts: {
    userId: string;
    now: ISODateTime;
    gradebookName?: string | undefined;
    courseIdFor: (name: string) => string | undefined;
  },
): Assignment[] {
  if (!Array.isArray(rows)) return [];
  const out: Assignment[] = [];

  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const title = asString(pick(row, "AssignmentName", "Description", "Assignment", "name"));
    if (!title) continue;

    const number = asString(pick(row, "AssignmentNumber", "GradebookAssignmentNumber", "id"));
    const gradebook =
      asString(pick(row, "GradebookName", "CourseName", "Course")) ?? opts.gradebookName;

    const dueAt = asInstant(pick(row, "DueDate", "DateDue", "dueDate"));
    const points = asNumber(pick(row, "NumberCorrectPossible", "PointsPossible", "MaxScore"));
    const earned = asNumber(pick(row, "NumberCorrect", "Points", "Score"));
    const completed = pick(row, "Completed", "IsCompleted");
    const isMissing = pick(row, "Missing", "IsMissing") === true;

    // Only a real score counts as graded — a blank score is not a zero.
    const graded = earned !== undefined && points !== undefined;
    const state: Assignment["state"] = graded
      ? "graded"
      : isMissing
        ? "missing"
        : completed === true
          ? "submitted"
          : dueAt && new Date(dueAt).getTime() - Date.now() < 3 * 86_400_000
            ? "due_soon"
            : "assigned";

    const ref = `aeries:assignment:${gradebook ?? "unknown"}:${number ?? title}`;

    out.push({
      id: stableId(`${opts.userId}:${ref}`),
      userId: opts.userId,
      courseId: gradebook ? opts.courseIdFor(gradebook) : undefined,
      title,
      description: asString(pick(row, "Notes", "Comment")),
      dueAt,
      dueAllDay: true,
      state,
      estimateMin: estimateFromPoints(points),
      points,
      grade: graded ? `${earned}/${points}` : undefined,
      source: "aeries",
      sourceRef: ref,
      externalUrl: undefined,
      createdAt: opts.now,
      updatedAt: opts.now,
    });
  }

  return out;
}

/**
 * Aeries never says how long an assignment takes, so estimate from its weight —
 * clearly a heuristic, and the user can edit it.
 */
export function estimateFromPoints(points: number | undefined): number {
  if (points === undefined || points <= 0) return 30;
  if (points <= 10) return 20;
  if (points <= 25) return 35;
  if (points <= 50) return 50;
  if (points <= 100) return 75;
  return 90;
}

/** Aeries course-grade rows → a display grade per course name. */
export function normalizeAeriesGrades(
  rows: unknown,
): Array<{ courseName: string; grade: string; percent?: number }> {
  if (!Array.isArray(rows)) return [];
  const out: Array<{ courseName: string; grade: string; percent?: number }> = [];

  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Raw;
    const courseName = asString(pick(row, "CourseName", "Course", "GradebookName"));
    if (!courseName) continue;

    const mark = asString(pick(row, "Mark", "Grade", "LetterGrade"));
    const percent = asNumber(pick(row, "Percent", "Percentage", "PercentEarned"));
    if (!mark && percent === undefined) continue;

    out.push({
      courseName,
      grade: mark ?? `${Math.round(percent!)}%`,
      ...(percent === undefined ? {} : { percent }),
    });
  }

  return out;
}

// ---- fetch ---------------------------------------------------------------

export async function fetchAeries(userId: string): Promise<AeriesResult> {
  if (!aeriesConfigured()) {
    return {
      configured: false,
      ok: false,
      courses: [],
      assignments: [],
      grades: [],
      error:
        "Aeries needs AERIES_BASE_URL, AERIES_CERT and AERIES_STUDENT_ID. The certificate is issued by the district, not by Aeries.",
    };
  }

  const school = serverEnv.aeriesSchoolCode ?? "1";
  const student = serverEnv.aeriesStudentId!;
  const now = new Date().toISOString();
  const paths = {
    classes: serverEnv.aeriesPathClasses ?? DEFAULT_PATHS.classes,
    gradebooks: serverEnv.aeriesPathGradebooks ?? DEFAULT_PATHS.gradebooks,
    grades: serverEnv.aeriesPathGrades ?? DEFAULT_PATHS.grades,
  };

  try {
    // Classes first: assignments attach to the courses it produces.
    const classRows = await aeries<unknown>(paths.classes, { school, student });
    const courses = normalizeAeriesClasses(classRows, userId, now);
    const courseIdFor = (name: string): string | undefined =>
      courses.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id;

    const [gradebookRows, gradeRows] = await Promise.allSettled([
      aeries<unknown>(paths.gradebooks, { school, student }),
      aeries<unknown>(paths.grades, { school, student }),
    ]);

    const assignments =
      gradebookRows.status === "fulfilled"
        ? normalizeAeriesAssignments(gradebookRows.value, { userId, now, courseIdFor })
        : [];
    const grades = gradeRows.status === "fulfilled" ? normalizeAeriesGrades(gradeRows.value) : [];

    const partial: string[] = [];
    if (gradebookRows.status === "rejected") partial.push("gradebook");
    if (gradeRows.status === "rejected") partial.push("grades");

    return {
      configured: true,
      ok: true,
      courses,
      assignments,
      grades,
      fetchedAt: now,
      ...(partial.length > 0
        ? { error: `Imported classes, but ${partial.join(" and ")} could not be read.` }
        : {}),
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      courses: [],
      assignments: [],
      grades: [],
      error: error instanceof Error ? error.message : "Aeries request failed",
    };
  }
}

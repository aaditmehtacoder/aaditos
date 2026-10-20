/**
 * Aeries adapter — the official gradebook.
 *
 * Aeries is Santa Clara USD's student information system. There is no central
 * Aeries API: each district hosts its own at its own address, and access needs
 * an API certificate that a district Aeries administrator issues. Districts
 * do not normally give one to a student, so this adapter is honest about it:
 * without a certificate it reports "needs the district's help" and nothing
 * else in the app depends on it.
 *
 * With a certificate it reads classes (as courses, with teacher and period)
 * and gradebook assignments with scores, all read-only. Endpoint paths vary a
 * little between Aeries versions; the three `AERIES_PATH_*` variables override
 * the defaults if yours return 404.
 */

import { stableId } from "@/lib/core/ids";
import type { AeriesResult } from "@/lib/integrations/contracts";
import type { Assignment, Course, ISODateTime } from "@/lib/core/types";

import { serverEnv } from "../env";

export type { AeriesResult };

export function aeriesConfigured(): boolean {
  return Boolean(serverEnv.aeriesBaseUrl && serverEnv.aeriesCert && serverEnv.aeriesStudentId);
}

const DEFAULT_PATHS = {
  classes: "/api/v5/schools/{school}/students/{student}/classes",
  gradebooks: "/api/v5/schools/{school}/students/{student}/gradebooks",
  grades: "/api/v5/gradebooks/{gradebook}/students/{student}/assignments",
};

function fill(path: string, vars: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

interface AeriesClassRow {
  SectionNumber?: number | string;
  CourseTitle?: string;
  CourseName?: string;
  TeacherName?: string;
  Teacher?: string;
  Period?: number | string;
  Room?: string;
  RoomNumber?: string;
  CurrentMark?: string;
  Mark?: string;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Pure: Aeries class rows → courses. Exported for tests. */
export function normalizeAeriesClasses(rows: unknown, userId: string, now: ISODateTime): Course[] {
  if (!Array.isArray(rows)) return [];
  const out: Course[] = [];
  rows.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as AeriesClassRow;
    const name = (row.CourseTitle ?? row.CourseName ?? "").trim();
    const section = row.SectionNumber !== undefined ? String(row.SectionNumber) : "";
    if (!name || !section) return;
    const period = Number(row.Period);
    out.push({
      id: stableId(`${userId}:aeries:course:${section}`),
      userId,
      name,
      teacher: (row.TeacherName ?? row.Teacher ?? "").trim() || undefined,
      room: (row.Room ?? row.RoomNumber ?? "").toString().trim() || undefined,
      period: Number.isFinite(period) && period > 0 ? period : undefined,
      color: PALETTE[index % PALETTE.length] ?? "var(--chart-1)",
      grade: (row.CurrentMark ?? row.Mark ?? "").trim() || undefined,
      source: "aeries",
      sourceRef: `aeries:section:${section}`,
      externalUrl: serverEnv.aeriesBaseUrl,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });
  return out;
}

interface AeriesGradebookRow {
  GradebookNumber?: number | string;
  SectionNumber?: number | string;
  Name?: string;
}

interface AeriesAssignmentRow {
  AssignmentNumber?: number | string;
  Description?: string;
  DueDate?: string;
  NumberPossible?: number;
  Score?: number | null;
  NumberCorrect?: number | null;
  IsGraded?: boolean;
  IsMissing?: boolean;
}

/** Pure: gradebook assignment rows → assignments. Exported for tests. */
export function normalizeAeriesAssignments(
  rows: unknown,
  opts: { userId: string; now: ISODateTime; gradebook: string; courseId: string | undefined },
): Assignment[] {
  if (!Array.isArray(rows)) return [];
  const out: Assignment[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as AeriesAssignmentRow;
    const title = (row.Description ?? "").trim();
    if (!title || row.AssignmentNumber === undefined) continue;
    const due = row.DueDate ? new Date(row.DueDate) : null;
    const dueAt = due && !Number.isNaN(due.getTime()) ? due.toISOString() : undefined;
    const score = row.Score ?? row.NumberCorrect;
    const graded = row.IsGraded === true || (typeof score === "number" && score >= 0);
    const ref = `aeries:${opts.gradebook}:${row.AssignmentNumber}`;
    out.push({
      id: stableId(`${opts.userId}:${ref}`),
      userId: opts.userId,
      courseId: opts.courseId,
      title,
      dueAt,
      dueAllDay: true,
      state: row.IsMissing ? "missing" : graded ? "graded" : "assigned",
      estimateMin: 30,
      points: typeof row.NumberPossible === "number" ? row.NumberPossible : undefined,
      grade:
        graded && typeof score === "number" && typeof row.NumberPossible === "number"
          ? `${score}/${row.NumberPossible}`
          : undefined,
      source: "aeries",
      sourceRef: ref,
      externalUrl: serverEnv.aeriesBaseUrl,
      createdAt: opts.now,
      updatedAt: opts.now,
    });
  }
  return out;
}

async function get<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  const base = (serverEnv.aeriesBaseUrl ?? "").replace(/\/$/, "");
  const response = await fetchImpl(`${base}${path}`, {
    headers: { "AERIES-CERT": serverEnv.aeriesCert ?? "", accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Aeries rejected the certificate. Ask the district Aeries administrator.");
  }
  if (response.status === 404) {
    throw new Error(`Aeries returned 404 for ${path}. Set the AERIES_PATH_* overrides.`);
  }
  if (!response.ok) throw new Error(`Aeries returned ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchAeries(
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AeriesResult> {
  if (!aeriesConfigured()) {
    return {
      configured: false,
      ok: false,
      courses: [],
      assignments: [],
      error:
        "Aeries needs an API certificate from the district (AERIES_BASE_URL, AERIES_CERT, AERIES_SCHOOL_CODE, AERIES_STUDENT_ID).",
    };
  }
  const now = new Date().toISOString();
  const vars = {
    school: serverEnv.aeriesSchoolCode ?? "",
    student: serverEnv.aeriesStudentId ?? "",
  };
  try {
    const classes = await get<unknown>(
      fill(serverEnv.aeriesPathClasses ?? DEFAULT_PATHS.classes, vars),
      fetchImpl,
    );
    const courses = normalizeAeriesClasses(classes, userId, now);

    let assignments: Assignment[] = [];
    let problem: string | undefined;
    try {
      const gradebooks = await get<unknown>(
        fill(serverEnv.aeriesPathGradebooks ?? DEFAULT_PATHS.gradebooks, vars),
        fetchImpl,
      );
      const rows = Array.isArray(gradebooks) ? (gradebooks as AeriesGradebookRow[]) : [];
      for (const gb of rows.slice(0, 12)) {
        if (gb.GradebookNumber === undefined) continue;
        const gradebook = String(gb.GradebookNumber);
        const courseId = courses.find(
          (c) => c.sourceRef === `aeries:section:${String(gb.SectionNumber ?? "")}`,
        )?.id;
        const list = await get<unknown>(
          fill(serverEnv.aeriesPathGrades ?? DEFAULT_PATHS.grades, { ...vars, gradebook }),
          fetchImpl,
        ).catch(() => []);
        assignments = assignments.concat(
          normalizeAeriesAssignments(list, { userId, now, gradebook, courseId }),
        );
      }
    } catch (error) {
      problem = error instanceof Error ? error.message : "gradebooks unavailable";
    }

    return {
      configured: true,
      ok: true,
      courses,
      assignments,
      fetchedAt: now,
      ...(problem ? { error: `Grades: ${problem}` } : {}),
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      courses: [],
      assignments: [],
      error: error instanceof Error ? error.message : "Aeries request failed",
    };
  }
}

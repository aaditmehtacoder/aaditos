/**
 * What a workspace starts with.
 *
 * The class schedule is written once into a fresh account, so School and
 * "next class" are not empty until eight courses are typed in by hand. Seeded
 * rows carry `source: "demo"` with a `demo:` ref, which is what lets a later
 * Aeries or Classroom sync replace them instead of duplicating them.
 */

import { stableId } from "@/lib/core/ids";
import { dateKey } from "@/lib/core/time";
import type { Course, Profile, UserPreferences, UUID, Workspace } from "@/lib/core/types";

export function defaultPreferences(userId: UUID): UserPreferences {
  return {
    userId,
    theme: "system",
    workdayStart: "07:00",
    workdayEnd: "21:30",
    reducedMotion: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Aadit's real 2026–27 schedule, from his Aeries course list.
 *
 * `period` maps onto the bell schedule: 1-7 are the numbered periods and 8 is
 * SSR, which only meets on Wednesday and Friday. Ethnic Studies is a Fall-term
 * course (Trm F on the schedule); everything else runs the full year.
 */
const COURSE_DEFS = [
  {
    key: "pe9",
    name: "PE Core 9",
    teacher: "Currie, D",
    room: "Gym",
    period: 1,
    color: "var(--chart-5)",
  },
  {
    key: "spanish1",
    name: "Spanish 1",
    teacher: "Khurshudyan, K",
    room: "R-306",
    period: 2,
    color: "var(--chart-4)",
  },
  {
    key: "english9h",
    name: "English 9 H",
    teacher: "Robson, C",
    room: "B-210",
    period: 3,
    color: "var(--chart-2)",
  },
  {
    key: "ethnicstudies",
    name: "Ethnic Studies",
    teacher: "Stott, M",
    room: "B-214",
    period: 4,
    color: "var(--chart-3)",
  },
  {
    key: "financiallit",
    name: "Financial Lit",
    teacher: "Raffetto, A",
    room: "N-102",
    period: 5,
    color: "var(--chart-1)",
  },
  {
    key: "biology",
    name: "Biology",
    teacher: "Beadell, B",
    room: "S-103",
    period: 6,
    color: "var(--chart-2)",
  },
  {
    key: "algebra2",
    name: "Algebra 2",
    teacher: "Rebustes, R",
    room: "R-203",
    period: 7,
    color: "var(--chart-1)",
  },
  {
    key: "tutorial",
    name: "Tutorial",
    teacher: "Wall, B",
    room: undefined,
    period: 8,
    color: "var(--chart-5)",
  },
] as const;

export function seedCourses(userId: UUID, now: Date): Course[] {
  const iso = now.toISOString();
  return COURSE_DEFS.map((def) => ({
    id: courseId(userId, def.key),
    userId,
    name: def.name,
    teacher: def.teacher,
    room: def.room,
    period: def.period,
    color: def.color,
    grade: undefined,
    source: "demo" as const,
    sourceRef: `demo:course:${def.key}`,
    externalUrl: undefined,
    active: true,
    createdAt: iso,
    updatedAt: iso,
  }));
}

/**
 * A seeded course's row id.
 *
 * Scoped to the user on purpose. The class schedule is the same for everyone at
 * the school, so an id derived from the key alone is identical across accounts —
 * and `courses.id` is a primary key. Two accounts seeding the same schedule then
 * collide on `courses_pkey`, which is not the constraint the upsert resolves on,
 * so the insert fails outright instead of updating.
 */
function courseId(userId: UUID, key: string): string {
  return stableId(`${userId}:course:${key}`);
}

export function emptyWorkspace(userId: UUID, profile: Profile): Workspace {
  return {
    profile,
    preferences: defaultPreferences(userId),
    tasks: [],
    courses: [],
    assignments: [],
    events: [],
    notes: [],
    integrations: [],
    syncRuns: [],
  };
}

export function todayKey(now = new Date()): string {
  return dateKey(now);
}

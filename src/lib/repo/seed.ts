/**
 * Demo workspace.
 *
 * Everything here is generated relative to "now" so the app is explorable on
 * any day without external credentials. Demo records carry `source: "demo"`
 * (or a real source with a `demo:` ref) and the UI labels them as demo data —
 * they are never presented as live provider results.
 */

import { stableId } from "@/lib/core/ids";
import { APP_TZ, addDays, dateKey, zonedParts, zonedToUtc } from "@/lib/core/time";
import type {
  Assignment,
  CalendarEvent,
  Course,
  IntegrationRecord,
  Note,
  Profile,
  Task,
  UserPreferences,
  UUID,
  Workspace,
} from "@/lib/core/types";

export const DEMO_USER_ID = stableId("aaditos:demo-user");

export const DEMO_PROFILE: Profile = {
  id: DEMO_USER_ID,
  email: "demo@aaditos.app",
  name: "Aadit Mehta",
  school: "Wilcox High School",
  grade: "Grade 9",
  city: "Santa Clara, CA",
  timezone: APP_TZ,
};

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

/** Local wall-clock time on the day `dayOffset` days from `now`. */
function at(now: Date, dayOffset: number, hour: number, minute = 0): string {
  const p = zonedParts(addDays(now, dayOffset));
  return zonedToUtc(p.year, p.month, p.day, hour, minute, APP_TZ).toISOString();
}

function allDayAt(now: Date, dayOffset: number): string {
  return at(now, dayOffset, 0, 0);
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

export function seedTasks(userId: UUID, now: Date): Task[] {
  const iso = now.toISOString();
  const base = (
    n: number,
    partial: Omit<
      Task,
      "id" | "userId" | "position" | "createdAt" | "updatedAt" | "subtasks" | "dueAllDay"
    > &
      Partial<Pick<Task, "subtasks" | "dueAllDay">>,
  ): Task => ({
    id: stableId(`task:${n}`),
    userId,
    position: n,
    subtasks: [],
    dueAllDay: false,
    createdAt: iso,
    updatedAt: iso,
    ...partial,
  });

  return [
    base(1, {
      title: "Finish English 9 Honors summer reading response",
      description:
        "One page response to the summer reading prompt. Cite two passages with page numbers, MLA header.",
      category: "school",
      courseId: courseId(userId, "english9"),
      dueAt: at(now, 1, 8, 30),
      priority: "urgent",
      status: "in_progress",
      estimateMin: 35,
      source: "demo",
      sourceRef: "demo:task:1",
      externalUrl: "https://classroom.google.com",
      notes: "Ms. Patel wants an MLA header and page numbers for both citations.",
      subtasks: [
        { id: stableId("sub:1a"), title: "Re-read chapter 3", done: true, position: 0 },
        { id: stableId("sub:1b"), title: "Draft response", done: false, position: 1 },
        { id: stableId("sub:1c"), title: "Proofread and submit", done: false, position: 2 },
      ],
    }),
    base(2, {
      title: "Algebra 2 worksheet 1.1–1.3",
      category: "school",
      courseId: courseId(userId, "algebra2"),
      dueAt: at(now, 0, 18, 0),
      priority: "high",
      status: "todo",
      estimateMin: 30,
      source: "demo",
      sourceRef: "demo:task:2",
    }),
    base(3, {
      title: "Sign Biology lab safety contract",
      category: "school",
      courseId: courseId(userId, "biology"),
      dueAt: at(now, 0, 15, 0),
      priority: "normal",
      status: "todo",
      estimateMin: 5,
      source: "demo",
      sourceRef: "demo:task:3",
    }),
    base(4, {
      title: "Spanish 1 vocabulary set — Unidad 1",
      category: "school",
      courseId: courseId(userId, "spanish1"),
      dueAt: at(now, 3, 23, 59),
      dueAllDay: true,
      priority: "normal",
      status: "todo",
      estimateMin: 20,
      source: "demo",
      sourceRef: "demo:task:4",
    }),
    base(5, {
      title: "Venu P1 — issue #1754 campaign image regression",
      description: "Campaign image renders at 2x inside Safari email clients.",
      category: "work",
      dueAt: at(now, 0, 17, 30),
      priority: "urgent",
      status: "todo",
      estimateMin: 45,
      source: "demo",
      sourceRef: "demo:task:5",
      externalUrl: "https://github.com/",
    }),
    base(6, {
      title: "Confirm landing-page ownership with Jeremy",
      category: "work",
      dueAt: at(now, 1, 12, 0),
      priority: "high",
      status: "todo",
      estimateMin: 10,
      source: "demo",
      sourceRef: "demo:task:6",
    }),
    base(7, {
      title: "Follow up with 3 qualified YC founders (Pick44 audits)",
      category: "work",
      dueAt: at(now, 2, 16, 0),
      priority: "high",
      status: "todo",
      estimateMin: 25,
      source: "demo",
      sourceRef: "demo:task:7",
    }),
    base(8, {
      title: "Fix Origami Prep streak-reminder GitHub Action",
      description: "Workflow streak-reminder.yml has failed on every scheduled run since Monday.",
      category: "work",
      dueAt: at(now, 0, 21, 0),
      priority: "high",
      status: "todo",
      estimateMin: 40,
      source: "demo",
      sourceRef: "demo:task:8",
    }),
    base(9, {
      title: "Pack Chromebook charger and PE clothes",
      category: "personal",
      dueAt: at(now, 0, 7, 30),
      priority: "normal",
      status: "done",
      estimateMin: 5,
      source: "demo",
      sourceRef: "demo:task:9",
      completedAt: at(now, 0, 7, 25),
    }),
    base(10, {
      title: "Register for hackUMBC team track",
      category: "personal",
      dueAt: at(now, 20, 23, 59),
      dueAllDay: true,
      priority: "normal",
      status: "todo",
      estimateMin: 15,
      source: "demo",
      sourceRef: "demo:task:10",
      externalUrl: "https://hackumbc.tech",
    }),
    base(11, {
      title: "Draft OpenRubric judging pilot one-pager",
      category: "work",
      dueAt: at(now, 6, 23, 59),
      dueAllDay: true,
      priority: "normal",
      status: "todo",
      estimateMin: 50,
      source: "demo",
      sourceRef: "demo:task:11",
    }),
    base(12, {
      title: "Turn in ninth grade welcome handbook signature page",
      category: "school",
      courseId: courseId(userId, "advisory"),
      dueAt: at(now, -1, 15, 0),
      priority: "urgent",
      status: "todo",
      estimateMin: 5,
      source: "demo",
      sourceRef: "demo:task:12",
    }),
    base(13, {
      title: "Read one chapter of the Biology textbook",
      category: "school",
      courseId: courseId(userId, "biology"),
      priority: "low",
      status: "todo",
      estimateMin: 25,
      source: "demo",
      sourceRef: "demo:task:13",
    }),
    base(14, {
      title: "Ship AaditOS focus analytics",
      category: "work",
      dueAt: at(now, 4, 20, 0),
      priority: "normal",
      status: "todo",
      estimateMin: 90,
      source: "demo",
      sourceRef: "demo:task:14",
    }),
  ];
}

export function seedAssignments(userId: UUID, now: Date): Assignment[] {
  const iso = now.toISOString();
  const mk = (
    n: number,
    partial: Omit<Assignment, "id" | "userId" | "createdAt" | "updatedAt" | "dueAllDay"> &
      Partial<Pick<Assignment, "dueAllDay">>,
  ): Assignment => ({
    id: stableId(`assignment:${n}`),
    userId,
    dueAllDay: false,
    createdAt: iso,
    updatedAt: iso,
    ...partial,
  });

  return [
    mk(1, {
      title: "Summer reading response",
      courseId: courseId(userId, "english9"),
      dueAt: at(now, 1, 8, 30),
      state: "due_soon",
      estimateMin: 35,
      points: 20,
      source: "demo",
      sourceRef: "demo:assignment:1",
      externalUrl: "https://classroom.google.com",
    }),
    mk(2, {
      title: "Worksheet 1.1–1.3",
      courseId: courseId(userId, "algebra2"),
      dueAt: at(now, 0, 18, 0),
      state: "due_soon",
      estimateMin: 30,
      points: 15,
      source: "demo",
      sourceRef: "demo:assignment:2",
    }),
    mk(3, {
      title: "Lab safety contract",
      courseId: courseId(userId, "biology"),
      dueAt: at(now, 0, 15, 0),
      state: "due_soon",
      estimateMin: 5,
      source: "demo",
      sourceRef: "demo:assignment:3",
    }),
    mk(4, {
      title: "Unidad 1 vocabulary set",
      courseId: courseId(userId, "spanish1"),
      dueAt: at(now, 3, 23, 59),
      dueAllDay: true,
      state: "assigned",
      estimateMin: 20,
      source: "demo",
      sourceRef: "demo:assignment:4",
    }),
    mk(5, {
      title: "Student info verification form",
      courseId: courseId(userId, "advisory"),
      dueAt: at(now, -2, 15, 0),
      state: "missing",
      estimateMin: 10,
      source: "demo",
      sourceRef: "demo:assignment:5",
    }),
    mk(6, {
      title: "Welcome handbook signature page",
      courseId: courseId(userId, "advisory"),
      dueAt: at(now, -1, 15, 0),
      state: "submitted",
      estimateMin: 5,
      source: "demo",
      sourceRef: "demo:assignment:6",
    }),
    mk(7, {
      title: "Math placement diagnostic",
      courseId: courseId(userId, "algebra2"),
      dueAt: at(now, -5, 23, 59),
      state: "graded",
      estimateMin: 45,
      points: 50,
      grade: "48/50",
      source: "demo",
      sourceRef: "demo:assignment:7",
    }),
    mk(8, {
      title: "Reading inventory survey",
      courseId: courseId(userId, "english9"),
      dueAt: at(now, -5, 23, 59),
      state: "graded",
      estimateMin: 15,
      points: 10,
      grade: "10/10",
      source: "demo",
      sourceRef: "demo:assignment:8",
    }),
    mk(9, {
      title: "Unit 1 quiz — functions and graphs",
      courseId: courseId(userId, "algebra2"),
      dueAt: at(now, 9, 9, 25),
      state: "assigned",
      estimateMin: 60,
      source: "demo",
      sourceRef: "demo:assignment:9",
    }),
  ];
}

export function seedEvents(userId: UUID, now: Date): CalendarEvent[] {
  const iso = now.toISOString();
  const mk = (
    n: number,
    partial: Omit<CalendarEvent, "id" | "userId" | "createdAt" | "updatedAt">,
  ): CalendarEvent => ({
    id: `demo:${partial.calendarId}:${n}`,
    userId,
    createdAt: iso,
    updatedAt: iso,
    ...partial,
  });

  return [
    mk(1, {
      title: "Venu standup",
      description: "Discord · product channel",
      startAt: at(now, 0, 16, 0),
      endAt: at(now, 0, 16, 30),
      allDay: false,
      kind: "meeting",
      source: "demo",
      calendarId: "demo:personal",
    }),
    mk(2, {
      title: "Family dinner",
      startAt: at(now, 0, 19, 0),
      endAt: at(now, 0, 19, 45),
      allDay: false,
      kind: "personal",
      source: "demo",
      calendarId: "demo:personal",
    }),
    mk(3, {
      title: "Robotics interest meeting",
      location: "Room 302",
      startAt: at(now, 2, 10, 0),
      endAt: at(now, 2, 11, 0),
      allDay: false,
      kind: "school",
      source: "demo",
      calendarId: "demo:personal",
    }),
    mk(4, {
      title: "Counselor check-in",
      location: "Room 12",
      startAt: at(now, 5, 10, 30),
      endAt: at(now, 5, 11, 0),
      allDay: false,
      kind: "counseling",
      source: "demo",
      calendarId: "demo:counseling",
    }),
    mk(5, {
      title: "Picture Day",
      startAt: allDayAt(now, 7),
      allDay: true,
      kind: "school",
      source: "demo",
      calendarId: "demo:school",
    }),
    mk(6, {
      title: "Pick44 design partner call — Mara L.",
      startAt: at(now, 1, 15, 30),
      endAt: at(now, 1, 16, 0),
      allDay: false,
      kind: "meeting",
      source: "demo",
      calendarId: "demo:personal",
    }),
  ];
}

/**
 * A few notes, so a class page shows what the space is for rather than an
 * empty box. One per kind on the classes a ninth grader actually thinks about.
 */
export function seedNotes(userId: UUID, now: Date): Note[] {
  const iso = now.toISOString();
  const defs: Array<{ n: number; course: string; kind: Note["kind"]; body: string }> = [
    {
      n: 1,
      course: "english9h",
      kind: "thought",
      body: "Robson wants the thesis to be arguable — something someone could disagree with. Mine is currently just a summary.",
    },
    {
      n: 2,
      course: "english9h",
      kind: "idea",
      body: "Use the Gatsby green light for the symbolism essay instead of the obvious one everyone picks.",
    },
    {
      n: 3,
      course: "financiallit",
      kind: "idea",
      body: "Do the budget project on Origami Prep — real pricing, real numbers, no made-up company.",
    },
    {
      n: 4,
      course: "algebra2",
      kind: "thought",
      body: "I keep losing points on sign errors when factoring, not on the method. Slow down on line two.",
    },
    {
      n: 5,
      course: "biology",
      kind: "thought",
      body: "Ask Ms. about whether the lab write-up needs a hypothesis section — the rubric is ambiguous.",
    },
  ];

  return defs.map((def) => ({
    id: stableId(`note:${def.n}`),
    userId,
    courseId: courseId(userId, def.course),
    kind: def.kind,
    body: def.body,
    taskId: undefined,
    pinned: false,
    createdAt: iso,
    updatedAt: iso,
  }));
}

export function seedWorkspace(userId: UUID, profile: Profile, now = new Date()): Workspace {
  return {
    profile,
    preferences: defaultPreferences(userId),
    tasks: seedTasks(userId, now),
    courses: seedCourses(userId, now),
    assignments: seedAssignments(userId, now),
    events: seedEvents(userId, now),
    notes: seedNotes(userId, now),
    integrations: [] as IntegrationRecord[],
    syncRuns: [],
  };
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

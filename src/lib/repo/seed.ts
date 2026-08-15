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
  AppNotification,
  Assignment,
  CalendarEvent,
  Course,
  FocusSession,
  IntegrationRecord,
  Opportunity,
  Profile,
  Project,
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
    focusGoalHours: 10,
    weeklyTaskGoal: 18,
    workdayStart: "07:00",
    workdayEnd: "21:30",
    mutedNotificationCategories: [],
    browserNotifications: false,
    compassTone: "concise",
    compassAutoRunReadTools: true,
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
      projectId: "venu-ai",
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
      projectId: "venu-ai",
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
      projectId: "pick44",
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
      projectId: "origami-prep",
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
      projectId: "hackathons",
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
      projectId: "openrubric",
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
      projectId: "personal-builds",
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

export function seedProjects(userId: UUID, now: Date): Project[] {
  const iso = now.toISOString();
  const ago = (days: number, hour = 12): string => at(now, -days, hour);

  return [
    {
      id: "venu-ai",
      userId,
      name: "Venu AI",
      kind: "Internship · Product engineering",
      objective: "Ship Venue P1 fixes before the fall campaign launch.",
      progress: 72,
      health: "attention",
      blockers: ["Waiting on Jeremy for landing-page scope"],
      deadlineAt: at(now, 12, 17, 0),
      deadlineLabel: "Campaign launch",
      contact: "Jeremy — primary project contact",
      githubRepo: "RoboBearLLC/VenuAI",
      vercelProject: "venu-app",
      links: [{ label: "Venue P1 · issue #1754", url: "https://github.com" }],
      metrics: [
        { label: "Open issues", value: "6", delta: "-3 this week" },
        { label: "PRs merged", value: "4" },
        { label: "Hours logged", value: "9.5" },
      ],
      documents: [
        { name: "Venue P1 scope.md", meta: "Drive · edited 1d ago" },
        { name: "Campaign email QA.md", meta: "Drive · edited 3h ago" },
      ],
      activity: [
        { id: "va1", at: ago(0, 9), text: "Pushed fix for issue #1754", source: "demo" },
        { id: "va2", at: ago(0, 7), text: "Preview deployment succeeded", source: "demo" },
        { id: "va3", at: ago(1), text: "Campaign image and email flow delivered", source: "demo" },
        { id: "va4", at: ago(2), text: "UI and UX pass with Caleb", source: "demo" },
      ],
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "pick44",
      userId,
      name: "Pick44",
      kind: "Startup · Growth",
      objective: "Convert free audits into paying design partners.",
      progress: 48,
      health: "on_track",
      blockers: [],
      deadlineAt: at(now, 23, 17, 0),
      deadlineLabel: "5 design partners",
      githubRepo: "aaditmehtacoder/pick44",
      vercelProject: "pick44",
      links: [{ label: "pick44.com", url: "https://pick44.com" }],
      metrics: [
        { label: "Audits sent", value: "27", delta: "+6" },
        { label: "Qualified", value: "9" },
        { label: "Partners", value: "2" },
      ],
      documents: [
        { name: "Audit playbook.md", meta: "Drive · edited 2d ago" },
        { name: "Founder outreach list", meta: "Sheet · edited today" },
      ],
      activity: [
        { id: "pa1", at: ago(0, 10), text: "3 audit replies received", source: "demo" },
        { id: "pa2", at: ago(1), text: "Deployed pick44.com v2 landing", source: "demo" },
      ],
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "origami-prep",
      userId,
      name: "Origami Prep",
      kind: "Personal product",
      objective: "Keep the daily streak engine reliable before the school-year push.",
      progress: 60,
      health: "at_risk",
      blockers: ["streak-reminder.yml has failed on every run since Monday"],
      deadlineAt: at(now, 18, 17, 0),
      deadlineLabel: "Reliability milestone",
      githubRepo: "aaditmehtacoder/cwb-origamiprep",
      vercelProject: "origami-prep",
      links: [],
      metrics: [
        { label: "Active users", value: "312", delta: "+18" },
        { label: "Streaks kept", value: "64%" },
        { label: "Uptime", value: "99.1%" },
      ],
      documents: [{ name: "Reliability notes.md", meta: "Drive · edited 2d ago" }],
      activity: [
        { id: "oa1", at: ago(2), text: "Workflow streak-reminder.yml failed", source: "demo" },
        { id: "oa2", at: ago(4), text: "Production deploy succeeded", source: "demo" },
      ],
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "openrubric",
      userId,
      name: "OpenRubric",
      kind: "Open source · Hackathon tooling",
      objective: "Secure hackathon judging pilots for the fall season.",
      progress: 35,
      health: "on_track",
      blockers: [],
      deadlineAt: at(now, 45, 17, 0),
      deadlineLabel: "hackUMBC pilot",
      githubRepo: "aaditmehtacoder/openrubric",
      links: [],
      metrics: [
        { label: "Stars", value: "141", delta: "+22" },
        { label: "Pilots", value: "1" },
        { label: "Contributors", value: "4" },
      ],
      documents: [{ name: "Judging pilot one-pager", meta: "Draft · edited today" }],
      activity: [
        {
          id: "ra1",
          at: ago(0, 8),
          text: "Outreach email opened by a hackUMBC organizer",
          source: "demo",
        },
        { id: "ra2", at: ago(3), text: "Rubric schema v0.3 merged", source: "demo" },
      ],
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "personal-builds",
      userId,
      name: "Personal Builds",
      kind: "Sandbox",
      objective: "Ship one small tool per month, publicly.",
      progress: 55,
      health: "on_track",
      blockers: [],
      deadlineAt: at(now, 25, 17, 0),
      deadlineLabel: "This month's build",
      githubRepo: "aaditmehtacoder/dayflow",
      links: [],
      metrics: [
        { label: "Builds shipped", value: "7" },
        { label: "This month", value: "1" },
      ],
      documents: [{ name: "Build ideas.md", meta: "Drive · edited today" }],
      activity: [{ id: "ba1", at: ago(0, 11), text: "Pushed the AaditOS shell", source: "demo" }],
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: "hackathons",
      userId,
      name: "Hackathons",
      kind: "Competitions",
      objective: "Place at two fall hackathons with a shipped, judged project.",
      progress: 20,
      health: "attention",
      blockers: ["Team not confirmed"],
      deadlineAt: at(now, 51, 9, 0),
      deadlineLabel: "hackUMBC",
      githubRepo: "aaditmehtacoder/hacks",
      links: [{ label: "hackUMBC", url: "https://hackumbc.tech" }],
      metrics: [
        { label: "Registered", value: "0 / 2" },
        { label: "Teammates", value: "1 / 4" },
      ],
      documents: [{ name: "Hackathon shortlist", meta: "Sheet · edited 5d ago" }],
      activity: [{ id: "ha1", at: ago(6), text: "Refreshed the starter template", source: "demo" }],
      createdAt: iso,
      updatedAt: iso,
    },
  ];
}

export function seedOpportunities(userId: UUID, now: Date): Opportunity[] {
  const iso = now.toISOString();
  const mk = (
    n: number,
    partial: Omit<Opportunity, "id" | "userId" | "createdAt" | "updatedAt">,
  ): Opportunity => ({
    id: stableId(`opportunity:${n}`),
    userId,
    createdAt: iso,
    updatedAt: iso,
    ...partial,
  });

  return [
    mk(1, {
      org: "Y Combinator",
      title: "YC Startup Internship Expo",
      type: "event",
      stage: "applied",
      contact: "Expo operations team",
      deadlineAt: "2026-08-15T17:00:00.000Z",
      lastInteractionAt: at(now, -3, 11),
      lastInteractionNote: "Submitted profile",
      nextAction: "Prep a 60-second intro and a project list",
      notes: "Bring the Pick44 and Venu demos on the Chromebook.",
      relatedUrl: "https://www.ycombinator.com",
    }),
    mk(2, {
      org: "hackUMBC",
      title: "hackUMBC 2026 (Sep 26–27)",
      type: "hackathon",
      stage: "interested",
      contact: "Organizer — Priya R.",
      deadlineAt: "2026-09-12T23:59:00.000Z",
      lastInteractionAt: at(now, -5, 9),
      lastInteractionNote: "Newsletter announcement",
      nextAction: "Register the team track and confirm teammates",
      notes: "Remote-friendly judging; a good OpenRubric pilot candidate.",
      relatedUrl: "https://hackumbc.tech",
    }),
    mk(3, {
      org: "hackUMBC",
      title: "OpenRubric judging partnership",
      type: "sponsorship",
      stage: "follow_up",
      contact: "Organizer — Priya R.",
      deadlineAt: "2026-09-01T23:59:00.000Z",
      lastInteractionAt: at(now, -1, 14),
      lastInteractionNote: "Outreach email opened",
      nextAction: "Send the one-pager and pilot terms",
      notes: "They asked about offline judging support.",
    }),
    mk(4, {
      org: "Venu AI",
      title: "Part-time SWE (school-year hours)",
      type: "internship",
      stage: "interview",
      contact: "Jeremy K.",
      deadlineAt: at(now, 16, 17),
      lastInteractionAt: at(now, -1, 20),
      lastInteractionNote: "Discord DM about schedule",
      nextAction: "Propose 10 hrs/week around Period 6",
      notes: "Needs parent signature and a school work permit.",
    }),
    mk(5, {
      org: "Santa Clara City Library",
      title: "Teen tech mentor program",
      type: "application",
      stage: "discovered",
      contact: "Programs desk",
      deadlineAt: "2026-09-05T23:59:00.000Z",
      nextAction: "Read the requirements and time commitment",
      notes: "Saturdays, two hours. Counts for service hours.",
    }),
    mk(6, {
      org: "Mara L. (seed, dev tools)",
      title: "Pick44 design partner conversation",
      type: "founder",
      stage: "follow_up",
      contact: "Mara L.",
      deadlineAt: at(now, 13, 17),
      lastInteractionAt: at(now, -1, 10),
      lastInteractionNote: "Audit delivered",
      nextAction: "Send pricing and onboarding steps",
      notes: "Wants a weekly audit cadence.",
    }),
    mk(7, {
      org: "Congressional App Challenge",
      title: "CA-17 submission",
      type: "application",
      stage: "discovered",
      deadlineAt: "2026-10-30T23:59:00.000Z",
      nextAction: "Decide which project to enter",
      notes: "Origami Prep would qualify.",
    }),
    mk(8, {
      org: "Local robotics sponsor",
      title: "Wilcox robotics parts sponsorship",
      type: "sponsorship",
      stage: "closed",
      contact: "Coach Hall",
      lastInteractionAt: at(now, -8, 15),
      lastInteractionNote: "Declined this cycle",
      nextAction: "Revisit in spring",
      notes: "Budget already allocated.",
    }),
  ];
}

export function seedFocusSessions(userId: UUID, now: Date): FocusSession[] {
  const iso = now.toISOString();
  const defs: Array<[number, number, number, string, FocusSession["category"]]> = [
    [1, 45, 42, "Venu P1 — issue #1754", "work"],
    [1, 30, 30, "Algebra 2 practice set", "school"],
    [2, 60, 55, "Pick44 audit template", "work"],
    [2, 25, 18, "Spanish vocabulary drill", "school"],
    [3, 50, 50, "Origami Prep reliability", "work"],
    [4, 40, 36, "English reading response", "school"],
    [5, 30, 30, "OpenRubric schema", "work"],
    [6, 20, 20, "Inbox and follow-ups", "personal"],
  ];

  return defs.map(([daysAgo, planned, actual, title, category], i) => {
    const startedAt = at(now, -daysAgo, 16 + (i % 4), 0);
    return {
      id: stableId(`focus:${i}`),
      userId,
      taskTitle: title,
      category,
      plannedMin: planned,
      elapsedSec: actual * 60,
      status: "completed" as const,
      startedAt,
      endedAt: new Date(new Date(startedAt).getTime() + actual * 60_000).toISOString(),
      createdAt: iso,
      updatedAt: iso,
    };
  });
}

export function seedNotifications(userId: UUID, now: Date): AppNotification[] {
  const mk = (
    n: number,
    partial: Omit<AppNotification, "id" | "userId" | "dedupeKey">,
  ): AppNotification => ({
    id: stableId(`notification:${n}`),
    userId,
    dedupeKey: `demo:notification:${n}`,
    ...partial,
  });

  return [
    mk(1, {
      category: "urgent",
      title: "Assignment due in 2 hours",
      detail: "Biology lab safety contract · 3:00 PM",
      source: "demo",
      href: "/school",
      read: false,
      createdAt: at(now, 0, 13, 2),
    }),
    mk(2, {
      category: "projects",
      title: "GitHub Action failed",
      detail: "origami-prep · streak-reminder.yml",
      source: "demo",
      href: "/projects/origami-prep",
      read: false,
      createdAt: at(now, 0, 11, 40),
    }),
    mk(3, {
      category: "urgent",
      title: "Meeting begins in 15 minutes",
      detail: "Venu standup · Discord product channel",
      source: "demo",
      href: "/",
      read: false,
      createdAt: at(now, 0, 15, 45),
    }),
    mk(4, {
      category: "opportunities",
      title: "Internship follow-up is due",
      detail: "Venu part-time SWE · propose a schedule",
      source: "demo",
      href: "/opportunities",
      read: true,
      createdAt: at(now, 0, 9, 12),
    }),
    mk(5, {
      category: "school",
      title: "New Wilcox calendar event",
      detail: "Picture Day was added",
      source: "demo",
      href: "/school",
      read: true,
      createdAt: at(now, 0, 8, 5),
    }),
    mk(6, {
      category: "system",
      title: "Demo mode is on",
      detail: "Connect providers in Integrations to replace this sample data.",
      source: "demo",
      href: "/integrations",
      read: false,
      createdAt: at(now, -1, 18, 0),
    }),
    mk(7, {
      category: "school",
      title: "Grade posted",
      detail: "Math placement diagnostic · 48/50",
      source: "demo",
      href: "/school",
      read: true,
      createdAt: at(now, -1, 16, 30),
    }),
    mk(8, {
      category: "projects",
      title: "Deployment succeeded",
      detail: "pick44.com · production",
      source: "demo",
      href: "/projects/pick44",
      read: true,
      createdAt: at(now, -1, 12, 10),
    }),
  ];
}

export function seedWorkspace(userId: UUID, profile: Profile, now = new Date()): Workspace {
  return {
    profile,
    preferences: defaultPreferences(userId),
    tasks: seedTasks(userId, now),
    courses: seedCourses(userId, now),
    assignments: seedAssignments(userId, now),
    events: seedEvents(userId, now),
    projects: seedProjects(userId, now),
    opportunities: seedOpportunities(userId, now),
    focusSessions: seedFocusSessions(userId, now),
    notifications: seedNotifications(userId, now),
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
    projects: [],
    opportunities: [],
    focusSessions: [],
    notifications: [],
    integrations: [],
    syncRuns: [],
  };
}

export function todayKey(now = new Date()): string {
  return dateKey(now);
}

/**
 * Bell schedule and school-day logic.
 *
 * Wilcox runs a rotating block schedule, transcribed from the school's own
 * published bell schedule page:
 *
 *   Monday            all seven periods, 50 minutes each
 *   Tuesday/Thursday  odd blocks  — 1, 3, 5, 7 (90 minutes)
 *   Wednesday/Friday  even blocks — 2, SSR, 4, 6
 *
 * The school also overrides individual dates to run the all-seven pattern:
 * the first days of the year, and the "Adjusted Bell Schedule 1-7 Day" dates
 * the school lists. Those live in `ALL_SEVEN_DATES`.
 *
 * Which days are school days at all (breaks, holidays) still comes from the
 * synced Wilcox calendar rather than being guessed here.
 *
 * Source: https://wilcox.santaclarausd.org/about/bell-schedule
 */

import {
  dateKey,
  formatDateMedium,
  minutesIntoDay,
  parseDateKey,
  zonedParts,
  zonedToUtc,
} from "./time";
import type { CalendarEvent, Course, ISODate, ISODateTime, UUID } from "./types";

export interface BellPeriod {
  period: number;
  label: string;
  startMin: number;
  endMin: number;
}

/** SSR / Tutorial sits outside the numbered periods. */
export const SSR_PERIOD = 8;
/** Lunch and other non-class blocks. */
export const BREAK_PERIOD = 0;

const t = (h: number, m: number) => h * 60 + m;

/** Monday, the first days of the year, and any "1-7 Day" override. */
export const ALL_SEVEN_SCHEDULE: BellPeriod[] = [
  { period: 1, label: "Period 1", startMin: t(8, 45), endMin: t(9, 35) },
  { period: 2, label: "Period 2", startMin: t(9, 40), endMin: t(10, 30) },
  { period: 3, label: "Period 3", startMin: t(10, 40), endMin: t(11, 30) },
  { period: 4, label: "Period 4", startMin: t(11, 35), endMin: t(12, 30) },
  { period: BREAK_PERIOD, label: "Lunch", startMin: t(12, 30), endMin: t(13, 5) },
  { period: 5, label: "Period 5", startMin: t(13, 10), endMin: t(14, 0) },
  { period: 6, label: "Period 6", startMin: t(14, 5), endMin: t(14, 55) },
  { period: 7, label: "Period 7", startMin: t(15, 0), endMin: t(15, 50) },
];

/** Tuesday and Thursday: the odd blocks. */
export const ODD_BLOCK_SCHEDULE: BellPeriod[] = [
  { period: 1, label: "Period 1", startMin: t(8, 45), endMin: t(10, 15) },
  { period: 3, label: "Period 3", startMin: t(10, 25), endMin: t(12, 0) },
  { period: BREAK_PERIOD, label: "Lunch", startMin: t(12, 0), endMin: t(12, 35) },
  { period: 5, label: "Period 5", startMin: t(12, 40), endMin: t(14, 10) },
  { period: 7, label: "Period 7", startMin: t(14, 15), endMin: t(15, 45) },
];

/** Wednesday and Friday: the even blocks, with SSR in the second slot. */
export const EVEN_BLOCK_SCHEDULE: BellPeriod[] = [
  { period: 2, label: "Period 2", startMin: t(8, 45), endMin: t(10, 15) },
  { period: SSR_PERIOD, label: "SSR", startMin: t(10, 25), endMin: t(11, 20) },
  { period: BREAK_PERIOD, label: "Lunch", startMin: t(11, 20), endMin: t(11, 50) },
  { period: 4, label: "Period 4", startMin: t(12, 0), endMin: t(13, 30) },
  { period: 6, label: "Period 6", startMin: t(13, 35), endMin: t(15, 5) },
];

/**
 * Dates that run the all-seven pattern regardless of weekday. The first three
 * days of the year are 1-7, and the school flags specific "Adjusted Bell
 * Schedule 1-7 Day" dates through the year.
 */
export const ALL_SEVEN_DATES = new Set<ISODate>([
  "2026-08-10" as ISODate, // first day
  "2026-08-11" as ISODate,
  "2026-08-12" as ISODate,
  "2026-09-09" as ISODate,
  "2026-10-14" as ISODate,
  "2026-11-10" as ISODate,
  "2026-12-15" as ISODate,
]);

/** The bell schedule actually in effect on a given day. */
export function bellScheduleFor(day: Date | ISODateTime): BellPeriod[] {
  const key = dateKey(day);
  if (ALL_SEVEN_DATES.has(key as ISODate)) return ALL_SEVEN_SCHEDULE;
  switch (zonedParts(day).weekday) {
    case 1:
      return ALL_SEVEN_SCHEDULE; // Monday
    case 2:
    case 4:
      return ODD_BLOCK_SCHEDULE; // Tuesday, Thursday
    case 3:
    case 5:
      return EVEN_BLOCK_SCHEDULE; // Wednesday, Friday
    default:
      return ALL_SEVEN_SCHEDULE; // weekend: nothing renders, but keep it total
  }
}

/** Kept for callers that want a representative day. */
export const DEFAULT_BELL_SCHEDULE = ALL_SEVEN_SCHEDULE;

export const SCHOOL_YEAR = {
  label: "2026–27",
  firstDay: "2026-08-10" as ISODate,
  lastDay: "2027-06-04" as ISODate,
};

const NO_SCHOOL_PATTERNS = [
  /no school/i,
  /schools? closed/i,
  /holiday/i,
  /\bbreak\b/i,
  /recess/i,
  /professional development.*no school/i,
  /non[- ]?student day/i,
];

export interface SchoolDayStatus {
  isSchoolDay: boolean;
  /** Short human explanation, always safe to render. */
  reason: string;
  inSession: boolean;
  currentPeriod?: BellPeriod | undefined;
  nextPeriod?: BellPeriod | undefined;
  dayStartMin: number;
  dayEndMin: number;
}

export function schoolDayStatus(
  now: Date,
  events: CalendarEvent[],
  schedule: BellPeriod[] = bellScheduleFor(now),
): SchoolDayStatus {
  const parts = zonedParts(now);
  const key = dateKey(now);
  const first = schedule[0];
  const last = schedule[schedule.length - 1];
  const dayStartMin = first?.startMin ?? 8 * 60 + 30;
  const dayEndMin = last?.endMin ?? 15 * 60 + 10;

  const base: Omit<SchoolDayStatus, "isSchoolDay" | "reason" | "inSession"> = {
    dayStartMin,
    dayEndMin,
  };

  if (parts.weekday === 0 || parts.weekday === 6) {
    return { ...base, isSchoolDay: false, reason: "Weekend", inSession: false };
  }
  if (key < SCHOOL_YEAR.firstDay) {
    return {
      ...base,
      isSchoolDay: false,
      reason: `Summer — school starts ${formatSchoolDate(SCHOOL_YEAR.firstDay)}`,
      inSession: false,
    };
  }
  if (key > SCHOOL_YEAR.lastDay) {
    return { ...base, isSchoolDay: false, reason: "Outside the school year", inSession: false };
  }

  const blocking = events.find(
    (e) => dateKey(e.startAt) === key && NO_SCHOOL_PATTERNS.some((re) => re.test(e.title)),
  );
  if (blocking) {
    return { ...base, isSchoolDay: false, reason: blocking.title, inSession: false };
  }

  const nowMin = minutesIntoDay(now);
  const currentPeriod = schedule.find((p) => nowMin >= p.startMin && nowMin < p.endMin);
  const nextPeriod = schedule.find((p) => p.startMin > nowMin);

  return {
    ...base,
    isSchoolDay: true,
    reason:
      nowMin < dayStartMin
        ? `School day · first bell ${formatMin(dayStartMin)}`
        : nowMin >= dayEndMin
          ? "School day · classes are over"
          : `School day · ${currentPeriod?.label ?? "passing period"}`,
    inSession: nowMin >= dayStartMin && nowMin < dayEndMin,
    currentPeriod,
    nextPeriod,
  };
}

/**
 * Formats a calendar-date key for display.
 *
 * `new Date("2026-08-10")` is UTC midnight, which renders as the 9th in
 * Pacific time — this anchors to local midnight first so the date shown is the
 * date meant.
 */
export function formatSchoolDate(key: ISODate): string {
  return formatDateMedium(parseDateKey(key));
}

export function formatMin(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m < 10 ? `0${m}` : m} ${suffix}`;
}

/** Synthesize today's class blocks from the course list and bell schedule. */
export function classEventsForDay(
  courses: Course[],
  day: Date,
  userId: UUID,
  schedule: BellPeriod[] = bellScheduleFor(day),
): CalendarEvent[] {
  const parts = zonedParts(day);
  const nowIso: ISODateTime = new Date().toISOString();

  return schedule
    .flatMap((slot) => {
      const course = courses.find((c) => c.active && c.period === slot.period);
      if (!course && slot.period !== 0) return [];
      const title = course ? course.name : slot.label;
      const start = zonedToUtc(
        parts.year,
        parts.month,
        parts.day,
        Math.floor(slot.startMin / 60),
        slot.startMin % 60,
      );
      const end = zonedToUtc(
        parts.year,
        parts.month,
        parts.day,
        Math.floor(slot.endMin / 60),
        slot.endMin % 60,
      );
      const detail = course ? [course.room, course.teacher].filter(Boolean).join(" · ") : "Quad";
      const event: CalendarEvent = {
        id: `schedule:${dateKey(day)}:${slot.period}:${slot.label}`,
        userId,
        title,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        allDay: false,
        kind: "class",
        source: "manual",
        calendarId: "schedule",
        createdAt: nowIso,
        updatedAt: nowIso,
        location: detail || undefined,
        description: course ? slot.label : undefined,
      };
      return [event];
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

export function nextClassFor(
  courses: Course[],
  now: Date,
  schedule: BellPeriod[] = bellScheduleFor(now),
): { course: Course; slot: BellPeriod } | null {
  const nowMin = minutesIntoDay(now);
  for (const slot of schedule) {
    if (slot.endMin <= nowMin) continue;
    const course = courses.find((c) => c.active && c.period === slot.period);
    if (course) return { course, slot };
  }
  return null;
}

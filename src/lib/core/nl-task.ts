/**
 * Natural-language task capture.
 *
 * A deterministic parser turns "Finish Algebra 2 worksheet tomorrow at 6 PM for
 * 30 minutes" into a structured draft. The same `TaskDraft` shape is what Compass
 * returns from its `propose_task` tool, so a preview card renders identically
 * whether the draft came from the local parser or the model — and either way it
 * requires explicit confirmation before it is saved.
 */

import { z } from "zod";

import { APP_TZ, zonedParts, zonedToUtc } from "./time";
import { PRIORITIES, TASK_CATEGORIES } from "./types";
import type { Priority, TaskCategory } from "./types";

export const TaskDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.enum(["school", "work", "personal"]),
  courseName: z.string().max(120).optional(),
  dueAt: z.string().optional(),
  dueAllDay: z.boolean(),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  estimateMin: z.number().int().min(5).max(600),
  notes: z.string().max(2000).optional(),
  subtasks: z.array(z.string().min(1).max(160)).max(12).optional(),
});

export type TaskDraft = z.infer<typeof TaskDraftSchema>;

export interface ParseContext {
  now?: Date;
  courses?: string[];
  defaultEstimateMin?: number;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

interface Span {
  start: number;
  end: number;
}

/** Parse free text into a confirmable task draft. Never throws. */
export function parseTaskInput(input: string, ctx: ParseContext = {}): TaskDraft {
  const now = ctx.now ?? new Date();
  const text = input.trim();
  const lower = text.toLowerCase();
  const spans: Span[] = [];

  const duration = matchDuration(lower);
  if (duration) spans.push(duration.span);

  const time = matchTime(text);
  if (time) spans.push(time.span);

  const date = matchDate(lower, now);
  if (date) spans.push(date.span);

  const priority = matchPriority(lower);
  if (priority) spans.push(priority.span);

  const course = matchNamed(text, ctx.courses ?? []);

  const dueAllDay = Boolean(date) && !time;
  const dueAt = buildDueAt(now, date?.value ?? null, time?.value ?? null);

  const category: TaskCategory = course ? "school" : inferCategory(lower);

  const title = cleanTitle(text, spans) || text || "Untitled task";

  const draft: TaskDraft = {
    title,
    category,
    dueAllDay,
    priority: priority?.value ?? (date && dueAt ? inferPriorityFromDue(now, dueAt) : "normal"),
    estimateMin: duration?.value ?? ctx.defaultEstimateMin ?? 30,
  };
  if (dueAt) draft.dueAt = dueAt;
  if (course) draft.courseName = course;
  return draft;
}

function matchDuration(lower: string): { value: number; span: Span } | null {
  const re = /(?:for\s+)?(\d+(?:\.\d+)?)\s*(minutes|minute|mins|min|m|hours|hour|hrs|hr|h)\b/g;
  let best: { value: number; span: Span } | null = null;
  let m = re.exec(lower);
  while (m) {
    const raw = Number(m[1]);
    const unit = m[2] ?? "min";
    const isHour = /^h/.test(unit);
    const minutes = Math.round(isHour ? raw * 60 : raw);
    // A bare "9 m" is more likely a typo than a duration; require >= 5 minutes.
    if (minutes >= 5 && minutes <= 600) {
      best = { value: minutes, span: { start: m.index, end: m.index + m[0].length } };
    }
    m = re.exec(lower);
  }
  return best;
}

interface TimeValue {
  hour: number;
  minute: number;
}

function matchTime(text: string): { value: TimeValue; span: Span } | null {
  const re = /(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM|a\.m\.|p\.m\.)/;
  const m = re.exec(text);
  if (m) {
    let hour = Number(m[1]);
    const minute = Number(m[2] ?? "0");
    const meridiem = (m[3] ?? "").toLowerCase().replace(/\./g, "");
    if (hour >= 1 && hour <= 12 && minute < 60) {
      if (meridiem.startsWith("p") && hour !== 12) hour += 12;
      if (meridiem.startsWith("a") && hour === 12) hour = 0;
      return { value: { hour, minute }, span: { start: m.index, end: m.index + m[0].length } };
    }
  }
  const re24 = /\bat\s+(\d{1,2}):(\d{2})\b/;
  const m24 = re24.exec(text);
  if (m24) {
    const hour = Number(m24[1]);
    const minute = Number(m24[2]);
    if (hour < 24 && minute < 60) {
      return {
        value: { hour, minute },
        span: { start: m24.index, end: m24.index + m24[0].length },
      };
    }
  }
  return null;
}

interface DateValue {
  year: number;
  month: number;
  day: number;
}

function matchDate(lower: string, now: Date): { value: DateValue; span: Span } | null {
  const today = zonedParts(now, APP_TZ);
  const shift = (days: number): DateValue => {
    const base = zonedToUtc(today.year, today.month, today.day, 12, 0, APP_TZ);
    const moved = zonedParts(new Date(base.getTime() + days * 86_400_000), APP_TZ);
    return { year: moved.year, month: moved.month, day: moved.day };
  };

  const simple: Array<[RegExp, number]> = [
    [/\b(today|tonight|this evening|this afternoon)\b/, 0],
    [/\btomorrow\b/, 1],
    [/\bday after tomorrow\b/, 2],
    [/\byesterday\b/, -1],
  ];
  for (const [re, days] of simple) {
    const m = re.exec(lower);
    if (m) return { value: shift(days), span: { start: m.index, end: m.index + m[0].length } };
  }

  const inDays = /\bin\s+(\d{1,2})\s+(day|days|week|weeks)\b/.exec(lower);
  if (inDays) {
    const n = Number(inDays[1]);
    const days = (inDays[2] ?? "day").startsWith("week") ? n * 7 : n;
    return {
      value: shift(days),
      span: { start: inDays.index, end: inDays.index + inDays[0].length },
    };
  }

  const weekday =
    /\b(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)\b/.exec(
      lower,
    );
  if (weekday) {
    const target = WEEKDAYS[weekday[2] ?? ""] ?? 0;
    let delta = (target - today.weekday + 7) % 7;
    if (delta === 0) delta = 7;
    if (weekday[1]) delta += 7;
    return {
      value: shift(delta),
      span: { start: weekday.index, end: weekday.index + weekday[0].length },
    };
  }

  const monthDay =
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})\b/.exec(
      lower,
    );
  if (monthDay) {
    const month = MONTHS[monthDay[1] ?? ""] ?? 1;
    const day = Number(monthDay[2]);
    const year =
      month < today.month || (month === today.month && day < today.day)
        ? today.year + 1
        : today.year;
    return {
      value: { year, month, day },
      span: { start: monthDay.index, end: monthDay.index + monthDay[0].length },
    };
  }

  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const rawYear = numeric[3] ? Number(numeric[3]) : undefined;
      const year =
        rawYear === undefined
          ? month < today.month || (month === today.month && day < today.day)
            ? today.year + 1
            : today.year
          : rawYear < 100
            ? 2000 + rawYear
            : rawYear;
      return {
        value: { year, month, day },
        span: { start: numeric.index, end: numeric.index + numeric[0].length },
      };
    }
  }

  return null;
}

function matchPriority(lower: string): { value: Priority; span: Span } | null {
  const patterns: Array<[RegExp, Priority]> = [
    [/\b(urgent|asap|critical|emergency)\b/, "urgent"],
    [/\b(high priority|important|must do)\b/, "high"],
    [/\b(low priority|someday|whenever|no rush)\b/, "low"],
  ];
  for (const [re, value] of patterns) {
    const m = re.exec(lower);
    if (m) return { value, span: { start: m.index, end: m.index + m[0].length } };
  }
  return null;
}

function matchNamed(text: string, names: string[]): string | undefined {
  const lower = text.toLowerCase();
  const sorted = [...names].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const n = name.toLowerCase();
    if (lower.includes(n)) return name;
    // "Algebra 2 worksheet" should also match a course named "Algebra 2 Honors".
    const head = n.split(" ").slice(0, 2).join(" ");
    if (head.length >= 5 && lower.includes(head)) return name;
  }
  return undefined;
}

function inferCategory(lower: string): TaskCategory {
  if (
    /\b(homework|essay|worksheet|quiz|test|exam|lab|reading|study|class|assignment)\b/.test(lower)
  )
    return "school";
  if (/\b(deploy|pr|issue|standup|client|founder|outreach|ship|bug|api|repo|meeting)\b/.test(lower))
    return "work";
  return "personal";
}

function inferPriorityFromDue(now: Date, dueAt: string): Priority {
  const hours = (new Date(dueAt).getTime() - now.getTime()) / 3_600_000;
  if (hours <= 0) return "urgent";
  if (hours <= 12) return "high";
  return "normal";
}

function buildDueAt(now: Date, date: DateValue | null, time: TimeValue | null): string | undefined {
  if (!date && !time) return undefined;
  const today = zonedParts(now, APP_TZ);
  const d = date ?? { year: today.year, month: today.month, day: today.day };
  const t = time ?? { hour: 23, minute: 59 };
  const instant = zonedToUtc(d.year, d.month, d.day, t.hour, t.minute, APP_TZ);
  // "at 6pm" with no date and 6pm already gone means tomorrow.
  if (!date && time && instant.getTime() < now.getTime()) {
    return new Date(instant.getTime() + 86_400_000).toISOString();
  }
  return instant.toISOString();
}

function cleanTitle(text: string, spans: Span[]): string {
  if (spans.length === 0) return tidy(text);
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const span of sorted) {
    if (span.start < cursor) continue;
    out += text.slice(cursor, span.start);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return tidy(out);
}

function tidy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*[,;]\s*$/, "")
    .replace(/\b(due|by|on|at|for)\s*$/i, "")
    .replace(/^\s*(due|by|on|at|for)\s+/i, "")
    .trim();
}

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as string[]).includes(value);
}

export function isCategory(value: string): value is TaskCategory {
  return (TASK_CATEGORIES as string[]).includes(value);
}

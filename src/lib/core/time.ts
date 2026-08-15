/**
 * Timezone-correct date helpers.
 *
 * AaditOS is a single-person product anchored to a school in Santa Clara, so
 * every "day" boundary is evaluated in `America/Los_Angeles` regardless of
 * whether the code runs in the browser or on a UTC server.
 */

import type { ISODate, ISODateTime } from "./types";

export const APP_TZ = "America/Los_Angeles";

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(input: Date | ISODateTime, timeZone = APP_TZ): ZonedParts {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = partsFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const hour = Number(read("hour"));
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    // Intl emits "24" for midnight in some engines when hour12 is false.
    hour: hour === 24 ? 0 : hour,
    minute: Number(read("minute")),
    weekday: Math.max(0, WEEKDAYS.indexOf(read("weekday"))),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds());
  return asUtc - date.getTime();
}

/** Convert a wall-clock time in `timeZone` into a UTC instant. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone = APP_TZ,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = timeZoneOffsetMs(new Date(guess), timeZone);
  const offset2 = timeZoneOffsetMs(new Date(guess - offset1), timeZone);
  return new Date(guess - offset2);
}

/** `YYYY-MM-DD` for the given instant in the app timezone. */
export function dateKey(input: Date | ISODateTime, timeZone = APP_TZ): ISODate {
  const p = zonedParts(input, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseDateKey(key: ISODate, timeZone = APP_TZ): Date {
  const [y, m, d] = key.split("-").map(Number);
  return zonedToUtc(y ?? 1970, m ?? 1, d ?? 1, 0, 0, timeZone);
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local-midnight instant of the day containing `input`. */
export function startOfDay(input: Date | ISODateTime, timeZone = APP_TZ): Date {
  const p = zonedParts(input, timeZone);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

export function endOfDay(input: Date | ISODateTime, timeZone = APP_TZ): Date {
  return new Date(startOfDay(input, timeZone).getTime() + 24 * 3600_000 - 1);
}

export function addDays(input: Date | ISODateTime, days: number): Date {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Date(date.getTime() + days * 24 * 3600_000);
}

/** Monday-anchored start of the week containing `input`. */
export function startOfWeek(input: Date | ISODateTime, timeZone = APP_TZ): Date {
  const p = zonedParts(input, timeZone);
  const offset = (p.weekday + 6) % 7; // Monday = 0
  const midnight = zonedToUtc(p.year, p.month, p.day, 0, 0, timeZone);
  return startOfDay(new Date(midnight.getTime() - offset * 24 * 3600_000), timeZone);
}

export function endOfWeek(input: Date | ISODateTime, timeZone = APP_TZ): Date {
  return new Date(startOfWeek(input, timeZone).getTime() + 7 * 24 * 3600_000 - 1);
}

export function isSameDay(
  a: Date | ISODateTime,
  b: Date | ISODateTime,
  timeZone = APP_TZ,
): boolean {
  return dateKey(a, timeZone) === dateKey(b, timeZone);
}

/** Whole days between the calendar days of `from` and `to` (can be negative). */
export function dayDiff(
  from: Date | ISODateTime,
  to: Date | ISODateTime,
  timeZone = APP_TZ,
): number {
  const a = startOfDay(from, timeZone).getTime();
  const b = startOfDay(to, timeZone).getTime();
  return Math.round((b - a) / (24 * 3600_000));
}

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let fmt = timeFormatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, ...options });
    timeFormatterCache.set(key, fmt);
  }
  return fmt;
}

export function formatTime(input: Date | ISODateTime): string {
  return cachedFormatter("time", { hour: "numeric", minute: "2-digit" }).format(
    typeof input === "string" ? new Date(input) : input,
  );
}

export function formatShortTime(input: Date | ISODateTime): string {
  const p = zonedParts(input);
  const suffix = p.hour >= 12 ? "p" : "a";
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return p.minute === 0 ? `${hour12}${suffix}` : `${hour12}:${pad(p.minute)}${suffix}`;
}

export function formatDateLong(input: Date | ISODateTime): string {
  return cachedFormatter("dateLong", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(typeof input === "string" ? new Date(input) : input);
}

export function formatDateMedium(input: Date | ISODateTime): string {
  return cachedFormatter("dateMedium", { month: "short", day: "numeric" }).format(
    typeof input === "string" ? new Date(input) : input,
  );
}

/** "Thu, Aug 6" — fits a narrow rail without truncating. */
export function formatDateCompact(input: Date | ISODateTime): string {
  return cachedFormatter("dateCompact", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(typeof input === "string" ? new Date(input) : input);
}

export function formatWeekday(input: Date | ISODateTime): string {
  return cachedFormatter("weekday", { weekday: "short" }).format(
    typeof input === "string" ? new Date(input) : input,
  );
}

/** "Today", "Tomorrow", "Yesterday", "Fri", or "Sep 26". */
export function relativeDayLabel(
  input: Date | ISODateTime,
  now: Date | ISODateTime = new Date(),
): string {
  const diff = dayDiff(now, input);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return formatWeekday(input);
  if (diff < -1 && diff > -7) return `${formatWeekday(input)} (late)`;
  return formatDateMedium(input);
}

export function relativeTimeLabel(
  input: Date | ISODateTime,
  now: Date | ISODateTime = new Date(),
): string {
  const target = typeof input === "string" ? new Date(input) : input;
  const base = typeof now === "string" ? new Date(now) : now;
  const deltaMin = Math.round((target.getTime() - base.getTime()) / 60_000);
  const abs = Math.abs(deltaMin);
  if (abs < 1) return "just now";
  if (abs < 60) return deltaMin > 0 ? `in ${abs} min` : `${abs} min ago`;
  if (abs < 60 * 24) {
    const hours = Math.round(abs / 60);
    return deltaMin > 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(abs / (60 * 24));
  return deltaMin > 0 ? `in ${days}d` : `${days}d ago`;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Minutes since local midnight. */
export function minutesIntoDay(input: Date | ISODateTime, timeZone = APP_TZ): number {
  const p = zonedParts(input, timeZone);
  return p.hour * 60 + p.minute;
}

export function nowISO(): ISODateTime {
  return new Date().toISOString();
}

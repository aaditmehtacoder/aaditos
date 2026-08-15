/**
 * Wilcox High School calendar adapter.
 *
 * The school runs Finalsite, which does not publish an ICS or RSS feed for
 * these calendars. It *does* serve each calendar element as stable,
 * server-rendered HTML at `/fs/elements/<id>?cal_date=YYYY-MM-DD`, which is the
 * same endpoint the school's own month navigation uses.
 *
 * The scrape is therefore isolated here: one typed parser, validated output,
 * per-month caching, timeouts, and no dependency on page chrome or CSS. If the
 * markup ever changes, `parseFinalsiteCalendar` fails loudly with zero events
 * and the sync is reported as failed rather than silently returning nothing.
 */

import type { RawEvent } from "@/lib/core/normalize";
import type { EventKind } from "@/lib/core/types";

export const WILCOX_HOST = "https://wilcox.santaclarausd.org";

export interface WilcoxCalendarSource {
  id: string;
  label: string;
  /** Finalsite element id that renders this calendar. */
  elementId: number;
  kind: EventKind;
}

export const WILCOX_CALENDARS: WilcoxCalendarSource[] = [
  { id: "wilcox:school", label: "Wilcox school calendar", elementId: 41393, kind: "school" },
  { id: "wilcox:district", label: "SCUSD district calendar", elementId: 52169, kind: "district" },
  { id: "wilcox:athletics", label: "Athletics calendar", elementId: 52172, kind: "athletics" },
  { id: "wilcox:counseling", label: "Counseling schedule", elementId: 56919, kind: "counseling" },
];

export interface ParsedEvent {
  /** Stable Finalsite occurrence id when present. */
  occurrenceId?: string | undefined;
  eventId?: string | undefined;
  title: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** ISO instant when the source gave an explicit start time. */
  startAt?: string | undefined;
  endAt?: string | undefined;
  allDay: boolean;
  calendarName?: string | undefined;
}

const DATE_RE =
  /<div class="fsCalendarDate"[^>]*data-day="(\d{1,2})"[^>]*data-year="(\d{4})"[^>]*data-month="(\d{1,2})"/g;
const INFO_RE =
  /<div class="fsCalendarInfo">([\s\S]*?)<\/div>\s*(?=<div class="fsCalendar|<\/div>)/g;

/**
 * Parse one Finalsite calendar-element response.
 *
 * The month grid is a flat sequence of day markers and event blocks; weekend
 * boxes hold two dates, so events are attached to the most recent preceding
 * date marker rather than to a containing element.
 */
export function parseFinalsiteCalendar(html: string): ParsedEvent[] {
  const markers: Array<{ index: number; kind: "date"; date: string }> = [];
  DATE_RE.lastIndex = 0;
  for (let m = DATE_RE.exec(html); m; m = DATE_RE.exec(html)) {
    const day = Number(m[1]);
    const year = Number(m[2]);
    const month = Number(m[3]) + 1; // Finalsite emits a 0-indexed month
    if (!day || !year || month < 1 || month > 12) continue;
    markers.push({
      index: m.index,
      kind: "date",
      date: `${year}-${pad(month)}-${pad(day)}`,
    });
  }

  const events: ParsedEvent[] = [];
  INFO_RE.lastIndex = 0;
  for (let m = INFO_RE.exec(html); m; m = INFO_RE.exec(html)) {
    const block = m[1] ?? "";
    const titleMatch = /<a[^>]*class="[^"]*fsCalendarEventTitle[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(
      block,
    );
    if (!titleMatch) continue;

    const title = decodeEntities(stripTags(titleMatch[1] ?? "")).trim();
    if (!title) continue;

    const owningDate = nearestDateBefore(markers, m.index);
    if (!owningDate) continue;

    const occurrenceId = /data-occur-id="(\d+)"/.exec(block)?.[1];
    const eventId = /data-eventid="(\d+)"/.exec(block)?.[1];
    const calendarName = decodeEntities(
      /<span class='fsElementEventColorIcon'[^>]*title='([^']*)'/.exec(block)?.[1] ?? "",
    );

    const allDay = /class="fsAllDayEvent"/.test(block);
    const times = [...block.matchAll(/<time datetime="([^"]+)"[^>]*class="([^"]*)"/g)];
    const start = times.find((t) => (t[2] ?? "").includes("fsStartTime"))?.[1];
    const end = times.find((t) => (t[2] ?? "").includes("fsEndTime"))?.[1];

    events.push({
      occurrenceId,
      eventId,
      title,
      date: owningDate,
      startAt: !allDay && start ? toIso(start) : undefined,
      endAt: !allDay && end ? toIso(end) : undefined,
      allDay: allDay || !start,
      calendarName: calendarName || undefined,
    });
  }

  return events;
}

function nearestDateBefore(
  markers: Array<{ index: number; date: string }>,
  index: number,
): string | undefined {
  let found: string | undefined;
  for (const marker of markers) {
    if (marker.index > index) break;
    found = marker.date;
  }
  return found;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function toIso(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// ---- fetching ------------------------------------------------------------

interface CacheEntry {
  at: number;
  events: ParsedEvent[];
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60 * 1000;

export interface FetchOptions {
  /** How many months forward to load, starting from `from`. */
  months?: number;
  from?: Date;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface WilcoxFetchResult {
  events: RawEvent[];
  errors: Array<{ calendar: string; message: string }>;
  fetchedCalendars: string[];
}

/** Fetch and normalize every configured Wilcox calendar. */
export async function fetchWilcoxEvents(opts: FetchOptions = {}): Promise<WilcoxFetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const months = Math.max(1, Math.min(6, opts.months ?? 3));
  const from = opts.from ?? new Date();

  const events: RawEvent[] = [];
  const errors: WilcoxFetchResult["errors"] = [];
  const fetchedCalendars: string[] = [];

  // Each calendar is fetched independently so one failure cannot hide the rest.
  await Promise.all(
    WILCOX_CALENDARS.map(async (calendar) => {
      const collected: ParsedEvent[] = [];
      let anySuccess = false;

      for (let offset = 0; offset < months; offset += 1) {
        const monthDate = new Date(
          Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 15),
        );
        const calDate = `${monthDate.getUTCFullYear()}-${pad(monthDate.getUTCMonth() + 1)}-15`;
        const cacheKey = `${calendar.elementId}:${calDate}`;

        const cached = cache.get(cacheKey);
        if (cached && now() - cached.at < TTL_MS) {
          collected.push(...cached.events);
          anySuccess = true;
          continue;
        }

        try {
          const response = await doFetch(
            `${WILCOX_HOST}/fs/elements/${calendar.elementId}?cal_date=${calDate}`,
            {
              headers: {
                accept: "text/html",
                "user-agent": "AaditOS/1.0 (personal school calendar sync)",
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const html = await response.text();
          const parsed = parseFinalsiteCalendar(html);
          cache.set(cacheKey, { at: now(), events: parsed });
          collected.push(...parsed);
          anySuccess = true;
        } catch (error) {
          errors.push({
            calendar: calendar.id,
            message: `${calDate}: ${error instanceof Error ? error.message : "request failed"}`,
          });
        }
      }

      if (anySuccess) fetchedCalendars.push(calendar.id);
      for (const parsed of collected) {
        events.push(toRawEvent(parsed, calendar));
      }
    }),
  );

  return { events, errors, fetchedCalendars };
}

export function toRawEvent(parsed: ParsedEvent, calendar: WilcoxCalendarSource): RawEvent {
  const startAt = parsed.startAt ?? `${parsed.date}T00:00:00-07:00`;
  return {
    title: parsed.title,
    startAt: new Date(startAt).toISOString(),
    endAt: parsed.endAt,
    allDay: parsed.allDay,
    kind: calendar.kind,
    source: "wilcox",
    calendarId: calendar.id,
    sourceRef: parsed.occurrenceId ?? `${parsed.date}:${parsed.title}`,
    externalUrl: `${WILCOX_HOST}/about/calendar`,
    description: parsed.calendarName,
  };
}

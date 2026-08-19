/**
 * Calendar normalization and duplicate detection.
 *
 * Several providers describe the same real-world event ("Picture Day" appears
 * on both the Wilcox school feed and a personal Google Calendar). Normalization
 * converts each provider payload into a single `CalendarEvent` shape; the
 * deduper then collapses events that describe the same thing, preferring the
 * most authoritative source.
 */

import { dateKey } from "./time";
import type { CalendarEvent, EventKind, ISODateTime, SourceId, UUID } from "./types";

export interface RawEvent {
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  startAt: ISODateTime;
  endAt?: ISODateTime | undefined;
  allDay: boolean;
  kind: EventKind;
  source: SourceId;
  calendarId: string;
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
}

/**
 * Source precedence when two events collide. Higher wins — the school's own
 * calendar beats a personal copy of the same event.
 */
const SOURCE_RANK: Record<SourceId, number> = {
  wilcox: 100,
  google_classroom: 90,
  google_calendar: 80,
  manual: 70,
  demo: 1,
};

const NOISE_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "and",
  "at",
  "on",
  "in",
  "to",
  "with",
  "hs",
  "high",
  "school",
  "wilcox",
  "adrian",
  "event",
  "meeting",
]);

/** Lowercase, strip punctuation and boilerplate, sort remaining tokens. */
export function titleFingerprint(title: string): string {
  const tokens = title
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !NOISE_WORDS.has(t));
  if (tokens.length === 0) {
    // Titles made only of boilerplate or punctuation still need a distinct key,
    // otherwise unrelated events would collapse into one another.
    const alphanumeric = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    return alphanumeric || `raw:${title.trim().toLowerCase()}`;
  }
  return Array.from(new Set(tokens)).sort().join(" ");
}

export function normalizeEvent(
  raw: RawEvent,
  opts: { userId: UUID; now?: ISODateTime },
): CalendarEvent {
  const now = opts.now ?? new Date().toISOString();
  const start = new Date(raw.startAt);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid event start: ${raw.startAt}`);
  }
  let end: string | undefined;
  if (raw.endAt) {
    const parsed = new Date(raw.endAt);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > start.getTime()) {
      end = parsed.toISOString();
    }
  }

  return {
    id: stableEventId(raw, opts.userId),
    userId: opts.userId,
    title: raw.title.trim().replace(/\s{2,}/g, " "),
    description: raw.description?.trim() || undefined,
    location: raw.location?.trim() || undefined,
    startAt: start.toISOString(),
    endAt: end,
    allDay: raw.allDay,
    kind: raw.kind,
    source: raw.source,
    calendarId: raw.calendarId,
    sourceRef: raw.sourceRef,
    externalUrl: raw.externalUrl,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Deterministic id derived from (user, source, calendar, ref | title+start) so
 * that re-running an import updates rows instead of inserting duplicates.
 *
 * The user is part of the key, and has to be. The Wilcox calendars are public
 * and identical for everyone, so an id built from the event alone is the same
 * string in every account. `replaceEvents` deletes only the caller's own rows
 * and then upserts — so the upsert lands on a row belonging to someone else and
 * Postgres rejects it with "new row violates row-level security policy (USING
 * expression)". Sync fails wholesale, and the message points at RLS rather than
 * at the id collision actually causing it.
 */
export function stableEventId(raw: RawEvent, userId: UUID): string {
  const ref = raw.sourceRef ?? `${titleFingerprint(raw.title)}@${raw.startAt}`;
  return `${userId}:${raw.source}:${raw.calendarId}:${ref}`;
}

export interface DedupeResult {
  events: CalendarEvent[];
  duplicates: Array<{ kept: CalendarEvent; dropped: CalendarEvent; reason: string }>;
}

/**
 * Collapse events that describe the same occurrence.
 *
 * Two events are duplicates when they share a calendar day *and* either
 * (a) an identical title fingerprint, or (b) an identical start instant with a
 * strongly overlapping fingerprint.
 */
export function dedupeEvents(events: CalendarEvent[]): DedupeResult {
  const kept = new Map<string, CalendarEvent>();
  const duplicates: DedupeResult["duplicates"] = [];

  const byExactId = new Map<string, CalendarEvent>();
  for (const event of events) {
    const existing = byExactId.get(event.id);
    if (!existing) {
      byExactId.set(event.id, event);
    } else if (rank(event) > rank(existing)) {
      byExactId.set(event.id, event);
      duplicates.push({ kept: event, dropped: existing, reason: "same source id" });
    } else {
      duplicates.push({ kept: existing, dropped: event, reason: "same source id" });
    }
  }

  for (const event of byExactId.values()) {
    const day = dateKey(event.startAt);
    const fingerprint = titleFingerprint(event.title);
    const dayKey = `${day}|${fingerprint}`;
    const timeKey = `${event.startAt}|${fingerprint}`;

    const existing = kept.get(dayKey) ?? kept.get(timeKey);
    if (!existing) {
      kept.set(dayKey, event);
      continue;
    }

    const [winner, loser] = rank(event) > rank(existing) ? [event, existing] : [existing, event];
    kept.set(dayKey, winner);
    duplicates.push({
      kept: winner,
      dropped: loser,
      reason: `same day + title (${loser.source} → ${winner.source})`,
    });
  }

  const out = Array.from(new Set(kept.values())).sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  return { events: out, duplicates };
}

function rank(event: CalendarEvent): number {
  const base = SOURCE_RANK[event.source] ?? 0;
  // Richer records win ties: a timed event with a location beats a bare all-day copy.
  const detail = (event.endAt ? 2 : 0) + (event.location ? 1 : 0) + (event.allDay ? 0 : 1);
  return base * 10 + detail;
}

export function eventsForDay(events: CalendarEvent[], day: Date | ISODateTime): CalendarEvent[] {
  const key = dateKey(day);
  return events
    .filter((e) => dateKey(e.startAt) === key)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });
}

export interface Conflict {
  a: CalendarEvent;
  b: CalendarEvent;
  overlapMin: number;
}

/** Timed events on the same day whose intervals overlap. */
export function findConflicts(events: CalendarEvent[]): Conflict[] {
  const timed = events
    .filter((e) => !e.allDay && e.endAt)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const conflicts: Conflict[] = [];
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const a = timed[i];
      const b = timed[j];
      if (!a || !b) continue;
      const aStart = new Date(a.startAt).getTime();
      const aEnd = new Date(a.endAt ?? a.startAt).getTime();
      const bStart = new Date(b.startAt).getTime();
      const bEnd = new Date(b.endAt ?? b.startAt).getTime();
      if (bStart >= aEnd) break;
      const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
      if (overlap > 0) {
        conflicts.push({ a, b, overlapMin: Math.round(overlap / 60_000) });
      }
    }
  }
  return conflicts;
}

/**
 * Merge imported records over existing ones, keyed by `sourceRef` when the
 * provider supplies one and by `id` otherwise. Re-importing the same provider
 * payload therefore updates rows rather than duplicating them.
 *
 * Lives here rather than beside the sync hook so both the hook and the store
 * can use it without importing each other.
 */
export function mergeBySourceRef<T extends { id: string; sourceRef?: string | undefined }>(
  existing: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) return existing;
  const keyOf = (item: T) => item.sourceRef ?? item.id;
  const merged = new Map(existing.map((item) => [keyOf(item), item] as const));
  for (const item of incoming) merged.set(keyOf(item), item);
  return Array.from(merged.values());
}

import { describe, expect, it } from "vitest";

import {
  dedupeEvents,
  eventsForDay,
  findConflicts,
  normalizeEvent,
  stableEventId,
  titleFingerprint,
  type RawEvent,
} from "@/lib/core/normalize";
import { APP_TZ, zonedToUtc } from "@/lib/core/time";
import type { CalendarEvent, SourceId } from "@/lib/core/types";

const USER = "user-1";
const at = (h: number, m = 0, day = 12) => zonedToUtc(2026, 8, day, h, m, APP_TZ).toISOString();

function raw(partial: Partial<RawEvent> & { title: string; startAt: string }): RawEvent {
  return {
    allDay: false,
    kind: "school",
    source: "wilcox",
    calendarId: "wilcox:school",
    ...partial,
  };
}

function event(partial: Partial<CalendarEvent> & { id: string; title: string; startAt: string }) {
  return normalizeEvent(
    raw({
      title: partial.title,
      startAt: partial.startAt,
      endAt: partial.endAt,
      allDay: partial.allDay ?? false,
      source: (partial.source ?? "wilcox") as SourceId,
      calendarId: partial.calendarId ?? "wilcox:school",
      location: partial.location,
      sourceRef: partial.sourceRef,
    }),
    { userId: USER },
  );
}

describe("titleFingerprint", () => {
  it("ignores punctuation, case and school boilerplate", () => {
    expect(titleFingerprint("Picture Day")).toBe(titleFingerprint("picture day!"));
    expect(titleFingerprint("Wilcox High School Picture Day")).toBe(
      titleFingerprint("Picture Day"),
    );
  });

  it("keeps genuinely different titles distinct", () => {
    expect(titleFingerprint("Picture Day")).not.toBe(titleFingerprint("Club Fair"));
  });

  it("never returns an empty string", () => {
    expect(titleFingerprint("!!!").length).toBeGreaterThan(0);
  });
});

describe("normalizeEvent", () => {
  it("produces UTC instants and trims whitespace", () => {
    const normalized = normalizeEvent(raw({ title: "  Club   Fair  ", startAt: at(11, 30) }), {
      userId: USER,
    });
    expect(normalized.title).toBe("Club Fair");
    expect(normalized.startAt).toMatch(/Z$/);
    expect(normalized.userId).toBe(USER);
  });

  it("drops an end time that is not after the start", () => {
    const normalized = normalizeEvent(
      raw({ title: "Broken", startAt: at(11, 0), endAt: at(10, 0) }),
      { userId: USER },
    );
    expect(normalized.endAt).toBeUndefined();
  });

  it("rejects an unparseable start", () => {
    expect(() =>
      normalizeEvent(raw({ title: "Bad", startAt: "not-a-date" }), { userId: USER }),
    ).toThrow();
  });

  it("derives a stable id so re-imports update instead of duplicating", () => {
    const a = stableEventId(raw({ title: "Picture Day", startAt: at(9), sourceRef: "52124972" }));
    const b = stableEventId(raw({ title: "Picture Day", startAt: at(9), sourceRef: "52124972" }));
    expect(a).toBe(b);
  });
});

describe("dedupeEvents", () => {
  it("collapses the same event coming from two sources, keeping the authoritative one", () => {
    const result = dedupeEvents([
      event({ id: "1", title: "Picture Day", startAt: at(9), source: "wilcox" }),
      event({
        id: "2",
        title: "picture day",
        startAt: at(9),
        source: "google_calendar",
        calendarId: "gcal:personal",
      }),
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.source).toBe("wilcox");
    expect(result.duplicates).toHaveLength(1);
  });

  it("keeps distinct events on the same day", () => {
    const result = dedupeEvents([
      event({ id: "1", title: "Picture Day", startAt: at(9) }),
      event({ id: "2", title: "Club Fair", startAt: at(11) }),
    ]);
    expect(result.events).toHaveLength(2);
  });

  it("keeps the same title on different days", () => {
    const result = dedupeEvents([
      event({ id: "1", title: "ASB Club Training", startAt: at(15, 0, 26) }),
      event({ id: "2", title: "ASB Club Training", startAt: at(15, 0, 27) }),
    ]);
    expect(result.events).toHaveLength(2);
  });

  it("prefers the richer record when the source rank ties", () => {
    const result = dedupeEvents([
      event({ id: "1", title: "Counselor check-in", startAt: at(10, 30), allDay: true }),
      event({
        id: "2",
        title: "Counselor check-in",
        startAt: at(10, 30),
        endAt: at(11, 0),
        location: "Room 12",
      }),
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.location).toBe("Room 12");
  });

  it("returns events sorted by start time", () => {
    const result = dedupeEvents([
      event({ id: "1", title: "Late", startAt: at(16) }),
      event({ id: "2", title: "Early", startAt: at(8) }),
    ]);
    expect(result.events.map((e) => e.title)).toEqual(["Early", "Late"]);
  });

  it("is idempotent", () => {
    const first = dedupeEvents([
      event({ id: "1", title: "Picture Day", startAt: at(9) }),
      event({ id: "2", title: "Picture Day", startAt: at(9), source: "google_calendar" }),
    ]).events;
    expect(dedupeEvents(first).events).toHaveLength(1);
  });
});

describe("findConflicts", () => {
  it("finds overlapping timed events", () => {
    const conflicts = findConflicts([
      event({ id: "1", title: "Venu standup", startAt: at(16), endAt: at(16, 30) }),
      event({ id: "2", title: "Counselor", startAt: at(16, 15), endAt: at(16, 45) }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlapMin).toBe(15);
  });

  it("does not treat back-to-back events as a conflict", () => {
    expect(
      findConflicts([
        event({ id: "1", title: "A", startAt: at(16), endAt: at(16, 30) }),
        event({ id: "2", title: "B", startAt: at(16, 30), endAt: at(17) }),
      ]),
    ).toHaveLength(0);
  });

  it("ignores all-day events", () => {
    expect(
      findConflicts([
        event({ id: "1", title: "Picture Day", startAt: at(0), allDay: true }),
        event({ id: "2", title: "Class", startAt: at(9), endAt: at(10) }),
      ]),
    ).toHaveLength(0);
  });
});

describe("eventsForDay", () => {
  it("returns only that day, all-day events first", () => {
    const events = [
      event({ id: "1", title: "Class", startAt: at(9), endAt: at(10) }),
      event({ id: "2", title: "Picture Day", startAt: at(0), allDay: true }),
      event({ id: "3", title: "Tomorrow", startAt: at(9, 0, 13) }),
    ];
    const day = eventsForDay(events, at(12, 0));
    expect(day.map((e) => e.title)).toEqual(["Picture Day", "Class"]);
  });
});

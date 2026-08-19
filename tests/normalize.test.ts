import { describe, expect, it } from "vitest";

import {
  dedupeEvents,
  eventsForDay,
  findConflicts,
  normalizeEvent,
  stableEventId,
  titleFingerprint,
  type RawEvent,
  reownEvents,
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
    const a = stableEventId(
      raw({ title: "Picture Day", startAt: at(9), sourceRef: "52124972" }),
      "user-1",
    );
    const b = stableEventId(
      raw({ title: "Picture Day", startAt: at(9), sourceRef: "52124972" }),
      "user-1",
    );
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

/**
 * The Wilcox calendars are public and identical for every account, so an id
 * built from the event alone collides across users. `replaceEvents` deletes only
 * the caller's own rows and then upserts, so the upsert lands on another user's
 * row and Postgres rejects the whole sync with an RLS error that names the
 * policy rather than the collision. See stableEventId.
 */
describe("event ids are scoped to the user", () => {
  const shared = raw({ title: "Picture Day", startAt: at(9), sourceRef: "52124972" });

  it("gives two users different ids for the same public event", () => {
    expect(stableEventId(shared, "user-a")).not.toBe(stableEventId(shared, "user-b"));
  });

  it("stays stable for one user, so re-syncing updates rather than duplicates", () => {
    expect(stableEventId(shared, "user-a")).toBe(stableEventId(shared, "user-a"));
  });

  it("scopes the id normalizeEvent assigns, not just the helper", () => {
    const a = normalizeEvent(shared, { userId: "user-a" });
    const b = normalizeEvent(shared, { userId: "user-b" });
    expect(a.id).not.toBe(b.id);
  });
});

/**
 * Regression: the scheduled sync wrote the same event ids into every account
 * because it only swapped `userId` on already-normalized rows. `events.id` is
 * a global primary key, so each account's write overwrote the previous one and
 * the first user silently lost most of their calendar.
 */
describe("reownEvents", () => {
  const base = normalizeEvent(
    {
      title: "Picture Day",
      startAt: "2026-08-18T17:30:00.000Z",
      allDay: false,
      kind: "school",
      source: "wilcox",
      calendarId: "wilcox:school",
    },
    { userId: "cron" },
  );

  it("gives two accounts different ids for the same event", () => {
    const [a] = reownEvents([base], "user-a");
    const [b] = reownEvents([base], "user-b");
    expect(a!.id).not.toBe(b!.id);
    expect(a!.userId).toBe("user-a");
    expect(b!.userId).toBe("user-b");
  });

  it("produces the id that normalizing for that user directly would produce", () => {
    const direct = normalizeEvent(
      {
        title: "Picture Day",
        startAt: "2026-08-18T17:30:00.000Z",
        allDay: false,
        kind: "school",
        source: "wilcox",
        calendarId: "wilcox:school",
      },
      { userId: "user-a" },
    );
    const [reowned] = reownEvents([base], "user-a");
    expect(reowned!.id).toBe(direct.id);
  });

  it("is stable, so re-running the scheduled sync updates instead of inserting", () => {
    const first = reownEvents([base], "user-a");
    const second = reownEvents([base], "user-a");
    expect(first[0]!.id).toBe(second[0]!.id);
  });

  it("keeps everything else about the event intact", () => {
    const [reowned] = reownEvents([base], "user-a");
    expect(reowned!.title).toBe(base.title);
    expect(reowned!.startAt).toBe(base.startAt);
    expect(reowned!.calendarId).toBe(base.calendarId);
  });
});

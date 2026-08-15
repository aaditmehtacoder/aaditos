/**
 * Google Calendar and Classroom normalizers.
 *
 * The OAuth round trip needs a real Google project, so the tested surface is
 * the payload handling: correct all-day anchoring, submission state that never
 * invents a grade, and stable ids so re-syncing updates rather than duplicates.
 */

import { describe, expect, it } from "vitest";

import { dateKey } from "@/lib/core/time";
import {
  GOOGLE_SCOPES,
  buildConsentUrl,
  classroomDueInstant,
  normalizeClassroomCourses,
  normalizeClassroomWork,
  normalizeGoogleEvents,
} from "@/server/providers/google";

const USER = "user-1";
const NOW = "2026-08-12T14:00:00.000Z";

describe("GOOGLE_SCOPES", () => {
  const dataScopes = GOOGLE_SCOPES.filter((s) => s.startsWith("https://"));

  /**
   * `calendar.events` is the single deliberate exception to read-only, added so
   * a confirmed event reaches the user's real calendar. Pinning it by name is
   * the point: any *other* write scope appearing here should fail this test
   * rather than ride along unnoticed.
   */
  it("requests exactly one write scope, and it is calendar.events", () => {
    const writable = dataScopes.filter((s) => !s.endsWith(".readonly"));
    expect(writable).toEqual(["https://www.googleapis.com/auth/calendar.events"]);
  });

  it("never requests the full calendar scope, which could delete calendars", () => {
    expect(GOOGLE_SCOPES).not.toContain("https://www.googleapis.com/auth/calendar");
  });

  it("requests Gmail read-only, never send or modify", () => {
    const gmail = GOOGLE_SCOPES.filter((s) => s.includes("gmail"));
    expect(gmail).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });

  it("does not request Drive", () => {
    expect(GOOGLE_SCOPES.join(" ")).not.toMatch(/drive/);
  });
});

describe("buildConsentUrl", () => {
  const url = new URL(
    buildConsentUrl({ redirectUri: "https://app.example.com/api/google/callback", state: "abc" }),
  );

  it("asks for offline access so a refresh token comes back", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("carries the state value for CSRF protection", () => {
    expect(url.searchParams.get("state")).toBe("abc");
  });

  it("uses the exact redirect URI it was given", () => {
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/google/callback",
    );
  });
});

describe("normalizeGoogleEvents", () => {
  it("maps a timed event", () => {
    const [event] = normalizeGoogleEvents(
      [
        {
          id: "evt1",
          summary: "Dentist",
          location: "Santa Clara",
          htmlLink: "https://calendar.google.com/evt1",
          start: { dateTime: "2026-08-12T16:00:00-07:00" },
          end: { dateTime: "2026-08-12T17:00:00-07:00" },
        },
      ],
      "google:primary",
    );
    expect(event).toMatchObject({
      title: "Dentist",
      allDay: false,
      source: "google_calendar",
      sourceRef: "evt1",
      startAt: "2026-08-12T23:00:00.000Z",
    });
  });

  it("anchors an all-day event to the right local day, not UTC midnight", () => {
    const [event] = normalizeGoogleEvents(
      [{ id: "evt2", summary: "Picture Day", start: { date: "2026-08-14" } }],
      "google:primary",
    );
    expect(event?.allDay).toBe(true);
    // Naive UTC parsing would land this on the 13th in Pacific time.
    expect(dateKey(event!.startAt)).toBe("2026-08-14");
  });

  it("skips cancelled events", () => {
    expect(
      normalizeGoogleEvents(
        [{ id: "x", summary: "Gone", status: "cancelled", start: { date: "2026-08-14" } }],
        "google:primary",
      ),
    ).toEqual([]);
  });

  it("skips events with no title or no start", () => {
    expect(
      normalizeGoogleEvents(
        [
          { id: "a", start: { date: "2026-08-14" } },
          { id: "b", summary: "No start" },
        ],
        "google:primary",
      ),
    ).toEqual([]);
  });

  it("drops an unparseable end rather than failing the import", () => {
    const [event] = normalizeGoogleEvents(
      [
        {
          id: "e",
          summary: "Broken end",
          start: { dateTime: "2026-08-12T16:00:00Z" },
          end: { dateTime: "not-a-date" },
        },
      ],
      "google:primary",
    );
    expect(event?.endAt).toBeUndefined();
  });

  it("returns an empty array for a non-array payload", () => {
    expect(normalizeGoogleEvents({ error: "denied" }, "google:primary")).toEqual([]);
  });
});

describe("normalizeClassroomCourses", () => {
  it("keeps only active courses", () => {
    const courses = normalizeClassroomCourses(
      [
        { id: "1", name: "Algebra 2", courseState: "ACTIVE", room: "214" },
        { id: "2", name: "Old Class", courseState: "ARCHIVED" },
      ],
      USER,
      NOW,
    );
    expect(courses.map((c) => c.name)).toEqual(["Algebra 2"]);
    expect(courses[0]?.room).toBe("214");
  });

  it("produces a stable id and source ref", () => {
    const a = normalizeClassroomCourses([{ id: "77", name: "Biology" }], USER, NOW);
    const b = normalizeClassroomCourses(
      [{ id: "77", name: "Biology" }],
      USER,
      "2027-01-01T00:00:00.000Z",
    );
    expect(a[0]?.id).toBe(b[0]?.id);
    expect(a[0]?.sourceRef).toBe("google:course:77");
  });

  it("skips rows without an id or name", () => {
    expect(normalizeClassroomCourses([{ name: "No id" }, { id: "9" }], USER, NOW)).toEqual([]);
  });
});

describe("classroomDueInstant", () => {
  it("combines the split date and time objects", () => {
    expect(classroomDueInstant({ year: 2026, month: 8, day: 14 }, { hours: 23, minutes: 59 })).toBe(
      "2026-08-14T23:59:00.000Z",
    );
  });

  it("defaults to end of day when Classroom omits the time", () => {
    expect(classroomDueInstant({ year: 2026, month: 8, day: 14 })).toBe("2026-08-14T23:59:00.000Z");
  });

  it("returns undefined for an incomplete date", () => {
    expect(classroomDueInstant({ year: 2026 })).toBeUndefined();
    expect(classroomDueInstant(undefined)).toBeUndefined();
  });
});

describe("normalizeClassroomWork", () => {
  const courseIdFor = (id: string) => (id === "1" ? "local-course-1" : undefined);
  const opts = { userId: USER, now: NOW, courseIdFor };

  it("marks graded work and records the fraction", () => {
    const [assignment] = normalizeClassroomWork(
      [
        {
          id: "w1",
          courseId: "1",
          title: "Worksheet",
          state: "PUBLISHED",
          maxPoints: 20,
          dueDate: { year: 2026, month: 8, day: 14 },
        },
      ],
      [{ courseWorkId: "w1", state: "RETURNED", assignedGrade: 18 }],
      opts,
    );
    expect(assignment).toMatchObject({
      state: "graded",
      grade: "18/20",
      courseId: "local-course-1",
      dueAllDay: true,
    });
  });

  it("treats a turned-in but ungraded submission as submitted", () => {
    const [assignment] = normalizeClassroomWork(
      [{ id: "w2", courseId: "1", title: "Essay", state: "PUBLISHED" }],
      [{ courseWorkId: "w2", state: "TURNED_IN" }],
      opts,
    );
    expect(assignment?.state).toBe("submitted");
    expect(assignment?.grade).toBeUndefined();
  });

  it("marks a late, unsubmitted item as missing", () => {
    const [assignment] = normalizeClassroomWork(
      [{ id: "w3", courseId: "1", title: "Lab", state: "PUBLISHED" }],
      [{ courseWorkId: "w3", state: "CREATED", late: true }],
      opts,
    );
    expect(assignment?.state).toBe("missing");
  });

  it("falls back to assigned when there is no submission record", () => {
    const [assignment] = normalizeClassroomWork(
      [{ id: "w4", courseId: "1", title: "Reading", state: "PUBLISHED" }],
      [],
      opts,
    );
    expect(assignment?.state).toBe("assigned");
  });

  it("ignores draft coursework", () => {
    expect(
      normalizeClassroomWork(
        [{ id: "w5", courseId: "1", title: "Draft", state: "DRAFT" }],
        [],
        opts,
      ),
    ).toEqual([]);
  });

  it("marks a timed deadline as not all-day", () => {
    const [assignment] = normalizeClassroomWork(
      [
        {
          id: "w6",
          courseId: "1",
          title: "Quiz",
          state: "PUBLISHED",
          dueDate: { year: 2026, month: 8, day: 14 },
          dueTime: { hours: 15, minutes: 0 },
        },
      ],
      [],
      opts,
    );
    expect(assignment?.dueAllDay).toBe(false);
  });

  it("leaves courseId undefined for an unknown course", () => {
    const [assignment] = normalizeClassroomWork(
      [{ id: "w7", courseId: "999", title: "Orphan", state: "PUBLISHED" }],
      [],
      opts,
    );
    expect(assignment?.courseId).toBeUndefined();
  });

  it("returns an empty array for a non-array payload", () => {
    expect(normalizeClassroomWork(null, null, opts)).toEqual([]);
  });
});

describe("googleRedirectUri", () => {
  it("keeps http for a local server", async () => {
    const { googleRedirectUri } = await import("@/routes/api.google.auth");
    expect(googleRedirectUri(new Request("http://127.0.0.1:4173/api/google/auth"))).toBe(
      "http://127.0.0.1:4173/api/google/callback",
    );
    expect(googleRedirectUri(new Request("http://localhost:8080/api/google/auth"))).toBe(
      "http://localhost:8080/api/google/callback",
    );
  });

  it("trusts the proxy headers in production", () => {
    // Imported lazily above; re-require through the same module instance.
    return import("@/routes/api.google.auth").then(({ googleRedirectUri }) => {
      const request = new Request("http://internal:3000/api/google/auth", {
        headers: { "x-forwarded-host": "aaditos.vercel.app", "x-forwarded-proto": "https" },
      });
      expect(googleRedirectUri(request)).toBe("https://aaditos.vercel.app/api/google/callback");
    });
  });

  it("uses only the first value of a multi-hop forwarded proto", () => {
    return import("@/routes/api.google.auth").then(({ googleRedirectUri }) => {
      const request = new Request("http://internal:3000/api/google/auth", {
        headers: { "x-forwarded-host": "aaditos.vercel.app", "x-forwarded-proto": "https,http" },
      });
      expect(googleRedirectUri(request)).toBe("https://aaditos.vercel.app/api/google/callback");
    });
  });
});

/**
 * Row ids must be unique per user.
 *
 * `courses.id` and `assignments.id` are primary keys, but the upserts resolve
 * conflicts on `(user_id, source, source_ref)`. An id derived from provider data
 * alone is therefore identical across accounts, and the second account to sync
 * the same Classroom course violates `courses_pkey` — a constraint the ON
 * CONFLICT clause does not cover, so the insert fails outright. That surfaced as
 * "Could not load your workspace" and locked the account out entirely.
 */
describe("row ids are scoped to the user", () => {
  const course = [{ id: "c1", name: "Biology", courseState: "ACTIVE" }];

  it("gives two users different course ids for the same Classroom course", () => {
    const a = normalizeClassroomCourses(course, "user-a", NOW)[0];
    const b = normalizeClassroomCourses(course, "user-b", NOW)[0];
    expect(a?.id).not.toBe(b?.id);
  });

  it("still gives one user a stable id, so re-syncing updates rather than duplicates", () => {
    const first = normalizeClassroomCourses(course, USER, NOW)[0];
    const second = normalizeClassroomCourses(course, USER, NOW)[0];
    expect(first?.id).toBe(second?.id);
  });

  const work = [{ id: "w1", courseId: "c1", title: "Lab report", state: "PUBLISHED" }];
  const opts = (userId: string) => ({ userId, now: NOW, courseIdFor: () => undefined });

  it("gives two users different assignment ids for the same coursework", () => {
    const a = normalizeClassroomWork(work, [], opts("user-a"))[0];
    const b = normalizeClassroomWork(work, [], opts("user-b"))[0];
    expect(a?.id).not.toBe(b?.id);
  });

  it("keeps sourceRef provider-scoped, since that is what dedup matches on", () => {
    const a = normalizeClassroomCourses(course, "user-a", NOW)[0];
    const b = normalizeClassroomCourses(course, "user-b", NOW)[0];
    expect(a?.sourceRef).toBe(b?.sourceRef);
  });
});

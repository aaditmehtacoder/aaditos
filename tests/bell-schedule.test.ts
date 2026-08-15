/**
 * The Wilcox rotating bell schedule.
 *
 * Transcribed from the school's published page, so these tests are the record
 * of what was on it. If the school changes the rotation, these fail first.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_SEVEN_SCHEDULE,
  EVEN_BLOCK_SCHEDULE,
  ODD_BLOCK_SCHEDULE,
  SSR_PERIOD,
  bellScheduleFor,
  classEventsForDay,
  nextClassFor,
} from "@/lib/core/schedule";
import { seedCourses } from "@/lib/repo/seed";

/** Local noon, so the date is unambiguous in Pacific time. */
const at = (iso: string, h = 12, m = 0) =>
  new Date(`${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-07:00`);

const courses = seedCourses("user-1", new Date("2026-08-10T12:00:00Z"));

describe("which schedule runs on a given day", () => {
  it("runs all seven periods on a Monday", () => {
    // 2026-08-17 is a Monday.
    expect(bellScheduleFor(at("2026-08-17"))).toBe(ALL_SEVEN_SCHEDULE);
  });

  it("runs odd blocks on Tuesday and Thursday", () => {
    expect(bellScheduleFor(at("2026-08-18"))).toBe(ODD_BLOCK_SCHEDULE);
    expect(bellScheduleFor(at("2026-08-20"))).toBe(ODD_BLOCK_SCHEDULE);
  });

  it("runs even blocks on Wednesday and Friday", () => {
    expect(bellScheduleFor(at("2026-08-19"))).toBe(EVEN_BLOCK_SCHEDULE);
    expect(bellScheduleFor(at("2026-08-21"))).toBe(EVEN_BLOCK_SCHEDULE);
  });

  it("runs all seven for the first three days, overriding the weekday pattern", () => {
    // Aug 11 is a Tuesday and Aug 12 a Wednesday, but the school lists both as
    // 1-7 days, so the override must beat the rotation.
    expect(bellScheduleFor(at("2026-08-10"))).toBe(ALL_SEVEN_SCHEDULE);
    expect(bellScheduleFor(at("2026-08-11"))).toBe(ALL_SEVEN_SCHEDULE);
    expect(bellScheduleFor(at("2026-08-12"))).toBe(ALL_SEVEN_SCHEDULE);
  });

  it("honours the school's adjusted 1-7 days later in the year", () => {
    expect(bellScheduleFor(at("2026-09-09"))).toBe(ALL_SEVEN_SCHEDULE);
    expect(bellScheduleFor(at("2026-11-10"))).toBe(ALL_SEVEN_SCHEDULE);
  });
});

describe("period times match the published schedule", () => {
  it("starts every day at 8:45", () => {
    for (const s of [ALL_SEVEN_SCHEDULE, ODD_BLOCK_SCHEDULE, EVEN_BLOCK_SCHEDULE]) {
      expect(s[0]!.startMin).toBe(8 * 60 + 45);
    }
  });

  it("puts SSR only in the even-block day", () => {
    expect(EVEN_BLOCK_SCHEDULE.some((p) => p.period === SSR_PERIOD)).toBe(true);
    expect(ODD_BLOCK_SCHEDULE.some((p) => p.period === SSR_PERIOD)).toBe(false);
    expect(ALL_SEVEN_SCHEDULE.some((p) => p.period === SSR_PERIOD)).toBe(false);
  });

  it("runs odd blocks 1, 3, 5, 7 and even blocks 2, 4, 6", () => {
    expect(ODD_BLOCK_SCHEDULE.filter((p) => p.period > 0).map((p) => p.period)).toEqual([
      1, 3, 5, 7,
    ]);
    expect(
      EVEN_BLOCK_SCHEDULE.filter((p) => p.period > 0 && p.period !== SSR_PERIOD).map(
        (p) => p.period,
      ),
    ).toEqual([2, 4, 6]);
  });
});

describe("next class", () => {
  it("names the class actually next, not just the next period", () => {
    // Thursday: odd blocks. At 9am, Period 1 is running, so next is that class.
    const next = nextClassFor(courses, at("2026-08-20", 9, 0));
    expect(next?.course.name).toBe("PE Core 9");
    expect(next?.slot.period).toBe(1);
  });

  it("skips to Period 3 once Period 1 has ended on a block day", () => {
    const next = nextClassFor(courses, at("2026-08-20", 10, 20));
    expect(next?.course.name).toBe("English 9 H");
  });

  it("returns Tutorial for the SSR slot on a Wednesday", () => {
    const next = nextClassFor(courses, at("2026-08-19", 10, 30));
    expect(next?.course.name).toBe("Tutorial");
  });

  it("never offers an odd-block class on an even-block day", () => {
    // Friday runs 2, SSR, 4, 6 — Algebra 2 is Period 7 and must not appear.
    const next = nextClassFor(courses, at("2026-08-21", 8, 0));
    expect(next?.course.name).not.toBe("Algebra 2");
    expect([2, 4, 6, 8]).toContain(next?.slot.period);
  });

  it("returns null once the day's classes are over", () => {
    expect(nextClassFor(courses, at("2026-08-21", 20, 0))).toBeNull();
  });
});

describe("class events on the calendar", () => {
  it("puts every meeting class on a block day, and nothing that does not meet", () => {
    const events = classEventsForDay(courses, at("2026-08-20"), "user-1");
    const titles = events.map((e) => e.title);
    expect(titles).toContain("PE Core 9"); // P1
    expect(titles).toContain("English 9 H"); // P3
    expect(titles).toContain("Financial Lit"); // P5
    expect(titles).toContain("Algebra 2"); // P7
    expect(titles).not.toContain("Spanish 1"); // P2 does not meet Thursday
    expect(titles).not.toContain("Biology"); // P6 does not meet Thursday
  });

  it("includes Tutorial on Wednesday and omits it on Thursday", () => {
    const wed = classEventsForDay(courses, at("2026-08-19"), "user-1").map((e) => e.title);
    const thu = classEventsForDay(courses, at("2026-08-20"), "user-1").map((e) => e.title);
    expect(wed).toContain("Tutorial");
    expect(thu).not.toContain("Tutorial");
  });

  it("puts all seven classes on the first day of school", () => {
    const events = classEventsForDay(courses, at("2026-08-10"), "user-1");
    const classes = events.filter((e) => e.title !== "Lunch");
    expect(classes).toHaveLength(7);
  });
});

import { describe, expect, it } from "vitest";

import { autoPlanDay, buildPlannerModel, minutesToLabel, parseClock } from "@/lib/core/planner";
import { APP_TZ, zonedToUtc } from "@/lib/core/time";
import type { CalendarEvent, Task } from "@/lib/core/types";

const NOW = zonedToUtc(2026, 8, 12, 9, 0, APP_TZ); // Wed 12 Aug 2026, 9:00 AM PT
const at = (h: number, m = 0, day = 12) => zonedToUtc(2026, 8, day, h, m, APP_TZ).toISOString();

function event(
  partial: Partial<CalendarEvent> & { id: string; title: string; startAt: string },
): CalendarEvent {
  return {
    userId: "u1",
    allDay: false,
    kind: "personal",
    source: "manual",
    calendarId: "test",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...partial,
  };
}

function task(partial: Partial<Task> & { id: string; title: string }): Task {
  return {
    userId: "u1",
    category: "school",
    dueAllDay: false,
    priority: "normal",
    status: "todo",
    estimateMin: 30,
    source: "manual",
    subtasks: [],
    position: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...partial,
  };
}

const base = {
  now: NOW,
  workdayStart: "07:00",
  workdayEnd: "21:30",
};

describe("parseClock", () => {
  it("parses HH:MM into minutes", () => {
    expect(parseClock("07:00", 0)).toBe(420);
    expect(parseClock("21:30", 0)).toBe(1290);
  });

  it("falls back on nonsense rather than producing NaN", () => {
    expect(parseClock("", 480)).toBe(480);
    expect(parseClock("99:99", 480)).toBe(480);
    expect(parseClock("7am", 480)).toBe(480);
  });
});

describe("buildPlannerModel", () => {
  it("positions timed events on the minute grid", () => {
    const model = buildPlannerModel({
      ...base,
      events: [event({ id: "e1", title: "Standup", startAt: at(16), endAt: at(16, 30) })],
      classes: [],
      tasks: [],
    });
    expect(model.blocks).toHaveLength(1);
    expect(model.blocks[0]).toMatchObject({ startMin: 960, endMin: 990, kind: "event" });
  });

  it("separates all-day events from the grid", () => {
    const model = buildPlannerModel({
      ...base,
      events: [event({ id: "e1", title: "Picture Day", startAt: at(0), allDay: true })],
      classes: [],
      tasks: [],
    });
    expect(model.blocks).toHaveLength(0);
    expect(model.allDay).toHaveLength(1);
  });

  it("ignores events from other days", () => {
    const model = buildPlannerModel({
      ...base,
      events: [
        event({ id: "e1", title: "Tomorrow", startAt: at(10, 0, 13), endAt: at(11, 0, 13) }),
      ],
      classes: [],
      tasks: [],
    });
    expect(model.blocks).toHaveLength(0);
  });

  it("places a scheduled task as a block and leaves unscheduled ones off the grid", () => {
    const model = buildPlannerModel({
      ...base,
      events: [],
      classes: [],
      tasks: [
        task({ id: "t1", title: "Scheduled", startAt: at(10), estimateMin: 45 }),
        task({ id: "t2", title: "Unscheduled" }),
      ],
    });
    expect(model.blocks).toHaveLength(1);
    expect(model.blocks[0]).toMatchObject({ taskId: "t1", startMin: 600, endMin: 645 });
  });

  it("never places a completed task", () => {
    const model = buildPlannerModel({
      ...base,
      events: [],
      classes: [],
      tasks: [task({ id: "t1", title: "Done", startAt: at(10), status: "done" })],
    });
    expect(model.blocks).toHaveLength(0);
  });

  it("gives overlapping blocks side-by-side lanes", () => {
    const model = buildPlannerModel({
      ...base,
      events: [
        event({ id: "a", title: "Standup", startAt: at(16), endAt: at(16, 30) }),
        event({ id: "b", title: "Counselor", startAt: at(16, 15), endAt: at(16, 45) }),
      ],
      classes: [],
      tasks: [],
    });
    expect(model.blocks.every((b) => b.lanes === 2)).toBe(true);
    expect(new Set(model.blocks.map((b) => b.lane))).toEqual(new Set([0, 1]));
  });

  it("keeps sequential blocks in a single lane", () => {
    const model = buildPlannerModel({
      ...base,
      events: [
        event({ id: "a", title: "First", startAt: at(10), endAt: at(11) }),
        event({ id: "b", title: "Second", startAt: at(11), endAt: at(12) }),
      ],
      classes: [],
      tasks: [],
    });
    expect(model.blocks.every((b) => b.lanes === 1)).toBe(true);
  });

  it("computes the gaps between commitments", () => {
    const model = buildPlannerModel({
      ...base,
      events: [
        event({ id: "a", title: "Class", startAt: at(8, 30), endAt: at(15, 10) }),
        event({ id: "b", title: "Standup", startAt: at(16), endAt: at(16, 30) }),
      ],
      classes: [],
      tasks: [],
    });
    // 07:00–08:30, 15:10–16:00, 16:30–21:30
    expect(model.gaps.map((g) => g.minutes)).toEqual([90, 50, 300]);
    expect(model.freeMin).toBe(440);
  });

  it("merges overlapping commitments before computing gaps", () => {
    const model = buildPlannerModel({
      ...base,
      events: [
        event({ id: "a", title: "A", startAt: at(10), endAt: at(12) }),
        event({ id: "b", title: "B", startAt: at(11), endAt: at(13) }),
      ],
      classes: [],
      tasks: [],
    });
    expect(model.gaps.map((g) => [g.startMin, g.endMin])).toEqual([
      [420, 600],
      [780, 1290],
    ]);
  });

  it("drops gaps shorter than ten minutes", () => {
    const model = buildPlannerModel({
      ...base,
      events: [
        event({ id: "a", title: "A", startAt: at(7), endAt: at(10) }),
        event({ id: "b", title: "B", startAt: at(10, 5), endAt: at(21, 30) }),
      ],
      classes: [],
      tasks: [],
    });
    expect(model.gaps).toEqual([]);
  });
});

describe("autoPlanDay", () => {
  const model = buildPlannerModel({
    ...base,
    events: [event({ id: "class", title: "Class", startAt: at(12), endAt: at(15) })],
    classes: [],
    tasks: [],
  });

  it("fills gaps with ranked work and never double-books", () => {
    const result = autoPlanDay({
      now: NOW,
      model,
      schoolDay: true,
      tasks: [
        task({ id: "t1", title: "Urgent", priority: "urgent", estimateMin: 45, dueAt: at(18) }),
        task({ id: "t2", title: "Normal", estimateMin: 30, dueAt: at(20) }),
      ],
    });
    expect(result.placements).toHaveLength(2);
    expect(result.placements[0]?.taskId).toBe("t1");

    for (let i = 1; i < result.placements.length; i += 1) {
      expect(result.placements[i]!.startMin).toBeGreaterThanOrEqual(
        result.placements[i - 1]!.endMin,
      );
    }
  });

  it("never schedules into the past", () => {
    const result = autoPlanDay({
      now: NOW, // 9:00 AM
      model,
      schoolDay: true,
      tasks: [task({ id: "t1", title: "Work", estimateMin: 30 })],
    });
    expect(result.placements[0]?.startMin).toBeGreaterThanOrEqual(540);
  });

  it("skips work that does not fit and says why", () => {
    const result = autoPlanDay({
      now: NOW,
      model,
      schoolDay: true,
      tasks: [task({ id: "big", title: "Huge project", estimateMin: 600 })],
    });
    expect(result.placements).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/no open block/i);
  });

  it("leaves already-scheduled tasks alone", () => {
    const withScheduled = buildPlannerModel({
      ...base,
      events: [],
      classes: [],
      tasks: [task({ id: "t1", title: "Already planned", startAt: at(10), estimateMin: 30 })],
    });
    const result = autoPlanDay({
      now: NOW,
      model: withScheduled,
      schoolDay: true,
      tasks: [task({ id: "t1", title: "Already planned", startAt: at(10), estimateMin: 30 })],
    });
    expect(result.placements).toHaveLength(0);
  });

  it("inserts a break after ninety minutes of solid work", () => {
    const openDay = buildPlannerModel({ ...base, events: [], classes: [], tasks: [] });
    const result = autoPlanDay({
      now: NOW,
      model: openDay,
      schoolDay: true,
      tasks: [
        task({ id: "a", title: "A", estimateMin: 60, priority: "urgent", dueAt: at(20) }),
        task({ id: "b", title: "B", estimateMin: 45, priority: "high", dueAt: at(20) }),
        task({ id: "c", title: "C", estimateMin: 30, dueAt: at(20) }),
      ],
    });
    const third = result.placements[2];
    const second = result.placements[1];
    expect(third && second && third.startMin - second.endMin).toBeGreaterThanOrEqual(10);
  });

  it("reports the total time it planned", () => {
    const result = autoPlanDay({
      now: NOW,
      model,
      schoolDay: true,
      tasks: [task({ id: "t1", title: "Work", estimateMin: 45, dueAt: at(18) })],
    });
    expect(result.plannedMin).toBe(45);
  });
});

describe("minutesToLabel", () => {
  it("formats a 12-hour clock", () => {
    expect(minutesToLabel(0)).toBe("12 AM");
    expect(minutesToLabel(9 * 60)).toBe("9 AM");
    expect(minutesToLabel(12 * 60)).toBe("12 PM");
    expect(minutesToLabel(13 * 60 + 30)).toBe("1:30 PM");
    expect(minutesToLabel(21 * 60 + 5)).toBe("9:05 PM");
  });
});

describe("remaining free time", () => {
  it("counts only from now onward, matching what the rail shows", () => {
    const model = buildPlannerModel({ ...base, events: [], classes: [], tasks: [] });
    // Workday 07:00–21:30 is 870 minutes; at 09:00 there are 750 left.
    expect(model.freeMin).toBe(870);
    expect(model.remainingFreeMin).toBe(750);
  });

  it("excludes gaps that have already passed", () => {
    const model = buildPlannerModel({
      ...base,
      events: [event({ id: "a", title: "Block", startAt: at(8), endAt: at(20) })],
      classes: [],
      tasks: [],
    });
    // 07:00–08:00 is gone; only 20:00–21:30 remains.
    expect(model.remainingFreeMin).toBe(90);
    expect(model.largestRemainingGap?.startMin).toBe(1200);
  });

  it("reports no remaining gap once the day is full", () => {
    const model = buildPlannerModel({
      ...base,
      events: [event({ id: "a", title: "All day", startAt: at(7), endAt: at(21, 30) })],
      classes: [],
      tasks: [],
    });
    expect(model.remainingFreeMin).toBe(0);
    expect(model.largestRemainingGap).toBeNull();
  });
});

describe("slot sizing", () => {
  it("never books a slot shorter than fifteen minutes", () => {
    const model = buildPlannerModel({ ...base, events: [], classes: [], tasks: [] });
    const result = autoPlanDay({
      now: NOW,
      model,
      schoolDay: true,
      tasks: [task({ id: "tiny", title: "Sign form", estimateMin: 5, dueAt: at(18) })],
    });
    expect(result.placements[0]!.endMin - result.placements[0]!.startMin).toBe(15);
  });

  it("never overlaps two consecutive placements", () => {
    const model = buildPlannerModel({ ...base, events: [], classes: [], tasks: [] });
    const result = autoPlanDay({
      now: NOW,
      model,
      schoolDay: true,
      tasks: [
        task({ id: "a", title: "A", estimateMin: 5, dueAt: at(18), priority: "urgent" }),
        task({ id: "b", title: "B", estimateMin: 5, dueAt: at(18), priority: "high" }),
        task({ id: "c", title: "C", estimateMin: 5, dueAt: at(18) }),
      ],
    });
    for (let i = 1; i < result.placements.length; i += 1) {
      expect(result.placements[i]!.startMin).toBeGreaterThanOrEqual(
        result.placements[i - 1]!.endMin,
      );
    }
  });
});

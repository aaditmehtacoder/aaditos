import { describe, expect, it } from "vitest";

import {
  availableFocusMinutes,
  fitScore,
  mergeWindows,
  nextMove,
  rankTasks,
  scoreTask,
  urgencyScore,
} from "@/lib/core/priority";
import { APP_TZ, zonedToUtc } from "@/lib/core/time";
import type { Task } from "@/lib/core/types";

const NOW = zonedToUtc(2026, 8, 12, 14, 0, APP_TZ); // Wed 12 Aug 2026, 2:00 PM PT

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    userId: "u1",
    title: partial.title ?? partial.id,
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

const at = (h: number, m = 0, dayOffset = 0) =>
  zonedToUtc(2026, 8, 12 + dayOffset, h, m, APP_TZ).toISOString();

const ctx = { now: NOW, availableMin: 60, schoolDay: true };

describe("urgencyScore", () => {
  it("ranks overdue work above everything else", () => {
    const overdue = task({ id: "a", dueAt: at(9, 0, -2) });
    const dueNow = task({ id: "b", dueAt: at(15, 0) });
    expect(urgencyScore(overdue, NOW)).toBeGreaterThan(urgencyScore(dueNow, NOW));
  });

  it("decays as the deadline moves further out", () => {
    const today = urgencyScore(task({ id: "t", dueAt: at(20) }), NOW);
    const tomorrow = urgencyScore(task({ id: "t", dueAt: at(20, 0, 1) }), NOW);
    const nextWeek = urgencyScore(task({ id: "t", dueAt: at(20, 0, 8) }), NOW);
    expect(today).toBeGreaterThan(tomorrow);
    expect(tomorrow).toBeGreaterThan(nextWeek);
  });

  it("gives undated work a small non-zero floor", () => {
    const undated = urgencyScore(task({ id: "t" }), NOW);
    expect(undated).toBeGreaterThan(0);
    expect(undated).toBeLessThan(urgencyScore(task({ id: "t", dueAt: at(20, 0, 8) }), NOW));
  });

  it("escalates sharply inside the last hour", () => {
    const inTenMinutes = urgencyScore(task({ id: "t", dueAt: at(14, 10) }), NOW);
    const inFourHours = urgencyScore(task({ id: "t", dueAt: at(18, 0) }), NOW);
    expect(inTenMinutes).toBeGreaterThan(inFourHours);
  });
});

describe("fitScore", () => {
  it("rewards tasks that use the window well", () => {
    expect(fitScore(task({ id: "t", estimateMin: 45 }), 60)).toBeGreaterThan(
      fitScore(task({ id: "t", estimateMin: 5 }), 60),
    );
  });

  it("penalises tasks that do not fit", () => {
    expect(fitScore(task({ id: "t", estimateMin: 120 }), 30)).toBeLessThan(0);
  });

  it("penalises a wildly oversized task more than a slightly oversized one", () => {
    expect(fitScore(task({ id: "t", estimateMin: 300 }), 30)).toBeLessThan(
      fitScore(task({ id: "t", estimateMin: 40 }), 30),
    );
  });

  it("is neutral when no time is available", () => {
    expect(fitScore(task({ id: "t", estimateMin: 30 }), 0)).toBe(0);
  });
});

describe("scoreTask", () => {
  it("always explains itself", () => {
    const result = scoreTask(task({ id: "t", dueAt: at(15, 0), priority: "urgent" }), ctx);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toMatch(/due|priority|window/i);
  });

  it("boosts a task that is already in progress", () => {
    const base = task({ id: "t", dueAt: at(18) });
    const started = task({ id: "t", dueAt: at(18), status: "in_progress" });
    expect(scoreTask(started, ctx).score).toBeGreaterThan(scoreTask(base, ctx).score);
  });

  it("marks whether the task fits the available time", () => {
    expect(scoreTask(task({ id: "t", estimateMin: 30 }), ctx).fitsAvailableTime).toBe(true);
    expect(scoreTask(task({ id: "t", estimateMin: 120 }), ctx).fitsAvailableTime).toBe(false);
  });

  it("gives a quick win bonus to short work due today", () => {
    const quick = scoreTask(task({ id: "a", estimateMin: 5, dueAt: at(20) }), ctx);
    expect(quick.reasons).toContain("Quick win");
  });
});

describe("rankTasks / nextMove", () => {
  const tasks = [
    task({ id: "someday", title: "Someday idea", priority: "low", estimateMin: 90 }),
    task({
      id: "overdue",
      title: "Overdue form",
      dueAt: at(15, 0, -1),
      estimateMin: 5,
      priority: "urgent",
    }),
    task({ id: "later", title: "Next week essay", dueAt: at(12, 0, 9), estimateMin: 120 }),
    task({
      id: "tonight",
      title: "Worksheet",
      dueAt: at(18, 0),
      priority: "high",
      estimateMin: 30,
    }),
  ];

  it("puts overdue urgent work first", () => {
    expect(nextMove(tasks, ctx)?.task.id).toBe("overdue");
  });

  it("excludes completed and archived tasks", () => {
    const ranked = rankTasks(
      [...tasks, task({ id: "done", status: "done" }), task({ id: "arch", status: "archived" })],
      ctx,
    );
    expect(ranked.map((r) => r.task.id)).not.toContain("done");
    expect(ranked.map((r) => r.task.id)).not.toContain("arch");
  });

  it("prefers the task that fits when time is short", () => {
    const short = rankTasks(
      [
        task({ id: "big", title: "Big", dueAt: at(20), estimateMin: 180, priority: "high" }),
        task({ id: "small", title: "Small", dueAt: at(20), estimateMin: 15, priority: "high" }),
      ],
      { ...ctx, availableMin: 20 },
    );
    expect(short[0]?.task.id).toBe("small");
  });

  it("returns null when there is nothing rankable", () => {
    expect(nextMove([task({ id: "done", status: "done" })], ctx)).toBeNull();
  });

  it("is stable: ranking twice gives the same order", () => {
    const a = rankTasks(tasks, ctx).map((r) => r.task.id);
    const b = rankTasks(tasks, ctx).map((r) => r.task.id);
    expect(a).toEqual(b);
  });
});

describe("availableFocusMinutes", () => {
  it("subtracts busy blocks from the workday", () => {
    const result = availableFocusMinutes(
      [
        { startMin: 8 * 60 + 30, endMin: 15 * 60 + 10 }, // school
        { startMin: 16 * 60, endMin: 16 * 60 + 30 }, // standup
      ],
      { nowMin: 7 * 60, dayStartMin: 7 * 60, dayEndMin: 21 * 60 + 30 },
    );
    // 07:00-08:30 (90) + 15:10-16:00 (50) + 16:30-21:30 (300)
    expect(result.totalMin).toBe(440);
    expect(result.nextWindowMin).toBe(90);
  });

  it("ignores time already in the past", () => {
    const result = availableFocusMinutes([], {
      nowMin: 20 * 60,
      dayStartMin: 7 * 60,
      dayEndMin: 21 * 60,
    });
    expect(result.totalMin).toBe(60);
  });

  it("returns nothing once the workday is over", () => {
    const result = availableFocusMinutes([], {
      nowMin: 23 * 60,
      dayStartMin: 7 * 60,
      dayEndMin: 21 * 60,
    });
    expect(result.totalMin).toBe(0);
    expect(result.windows).toEqual([]);
  });

  it("drops slivers shorter than ten minutes", () => {
    const result = availableFocusMinutes(
      [
        { startMin: 600, endMin: 660 },
        { startMin: 665, endMin: 700 },
      ],
      { nowMin: 600, dayStartMin: 540, dayEndMin: 700 },
    );
    expect(result.windows).toEqual([]);
  });

  it("merges overlapping busy blocks", () => {
    expect(
      mergeWindows([
        { startMin: 60, endMin: 120 },
        { startMin: 100, endMin: 180 },
        { startMin: 300, endMin: 330 },
      ]),
    ).toEqual([
      { startMin: 60, endMin: 180 },
      { startMin: 300, endMin: 330 },
    ]);
  });
});

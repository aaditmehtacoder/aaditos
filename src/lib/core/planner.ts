/**
 * Day-planner model.
 *
 * Turns the day's events, class blocks and *scheduled* tasks into positioned
 * blocks on a minute grid, works out the gaps between them, and can fill those
 * gaps with the highest-value work that actually fits.
 *
 * A task counts as scheduled when it has `startAt`. Scheduling only ever sets
 * that field — it never changes a due date.
 */

import { rankTasks } from "./priority";
import { dateKey, minutesIntoDay } from "./time";
import type { CalendarEvent, Task } from "./types";

export type BlockKind = "class" | "event" | "task" | "focus";

export interface PlannerBlock {
  id: string;
  title: string;
  detail?: string | undefined;
  startMin: number;
  endMin: number;
  kind: BlockKind;
  taskId?: string | undefined;
  category?: Task["category"] | undefined;
  /** Column index and total columns, for side-by-side overlap layout. */
  lane: number;
  lanes: number;
  locked: boolean;
}

export interface PlannerGap {
  startMin: number;
  endMin: number;
  minutes: number;
}

export interface DayBounds {
  startMin: number;
  endMin: number;
}

export interface PlannerModel {
  bounds: DayBounds;
  blocks: PlannerBlock[];
  gaps: PlannerGap[];
  allDay: CalendarEvent[];
  scheduledMin: number;
  /** Open minutes across the whole workday. */
  freeMin: number;
  /**
   * Open minutes from now onward. This is the number the UI shows, so the
   * planner and the Today rail never disagree about how much time is left.
   */
  remainingFreeMin: number;
  /** The largest remaining gap — used for the "nothing planned yet" prompt. */
  largestRemainingGap: PlannerGap | null;
}

const MIN_USEFUL_GAP = 10;
/** Shortest slot the planner will book. Below this, blocks cannot be read. */
const MIN_SLOT = 15;

export function parseClock(value: string, fallbackMin: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallbackMin;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallbackMin;
  return hour * 60 + minute;
}

/** Assign overlapping blocks to side-by-side lanes. */
function layOutLanes(blocks: PlannerBlock[]): PlannerBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const clusters: PlannerBlock[][] = [];
  let current: PlannerBlock[] = [];
  let clusterEnd = -Infinity;

  for (const block of sorted) {
    if (current.length > 0 && block.startMin >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMin);
  }
  if (current.length > 0) clusters.push(current);

  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    for (const block of cluster) {
      let lane = laneEnds.findIndex((end) => end <= block.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(block.endMin);
      } else {
        laneEnds[lane] = block.endMin;
      }
      block.lane = lane;
    }
    for (const block of cluster) block.lanes = laneEnds.length;
  }

  return sorted;
}

export function buildPlannerModel(opts: {
  now: Date;
  events: CalendarEvent[];
  classes: CalendarEvent[];
  tasks: Task[];
  workdayStart: string;
  workdayEnd: string;
}): PlannerModel {
  const today = dateKey(opts.now);
  const dayStart = parseClock(opts.workdayStart, 7 * 60);
  const dayEnd = parseClock(opts.workdayEnd, 21 * 60 + 30);

  const timed: PlannerBlock[] = [];
  const allDay: CalendarEvent[] = [];

  const pushEvent = (event: CalendarEvent, kind: BlockKind) => {
    if (dateKey(event.startAt) !== today) return;
    if (event.allDay) {
      allDay.push(event);
      return;
    }
    const startMin = minutesIntoDay(event.startAt);
    const endMin = event.endAt ? minutesIntoDay(event.endAt) : startMin + 30;
    if (endMin <= startMin) return;
    timed.push({
      id: event.id,
      title: event.title,
      detail: event.location,
      startMin,
      endMin,
      kind,
      lane: 0,
      lanes: 1,
      locked: true,
    });
  };

  for (const event of opts.classes) pushEvent(event, "class");
  for (const event of opts.events) pushEvent(event, "event");

  for (const task of opts.tasks) {
    if (!task.startAt || task.status === "done" || task.status === "archived") continue;
    if (dateKey(task.startAt) !== today) continue;
    const startMin = minutesIntoDay(task.startAt);
    timed.push({
      id: `task:${task.id}`,
      title: task.title,
      startMin,
      endMin: startMin + Math.max(10, task.estimateMin),
      kind: "task",
      taskId: task.id,
      category: task.category,
      lane: 0,
      lanes: 1,
      locked: false,
    });
  }

  const blocks = layOutLanes(timed);

  // Gaps are computed against the merged span of everything, so an event that
  // starts before the workday still pushes the first gap later.
  const busy = [...blocks]
    .map((b) => ({ start: b.startMin, end: b.endMin }))
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of busy) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }

  const gaps: PlannerGap[] = [];
  let cursor = dayStart;
  for (const span of merged) {
    if (span.start > cursor) {
      const end = Math.min(span.start, dayEnd);
      if (end - cursor >= MIN_USEFUL_GAP) {
        gaps.push({ startMin: cursor, endMin: end, minutes: end - cursor });
      }
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < dayEnd && dayEnd - cursor >= MIN_USEFUL_GAP) {
    gaps.push({ startMin: cursor, endMin: dayEnd, minutes: dayEnd - cursor });
  }

  const scheduledMin = merged.reduce(
    (sum, span) => sum + Math.max(0, Math.min(span.end, dayEnd) - Math.max(span.start, dayStart)),
    0,
  );

  const nowMin = minutesIntoDay(opts.now);
  const remaining = gaps
    .map((gap) => ({ ...gap, startMin: Math.max(gap.startMin, nowMin) }))
    .map((gap) => ({ ...gap, minutes: gap.endMin - gap.startMin }))
    .filter((gap) => gap.minutes >= MIN_USEFUL_GAP);

  return {
    bounds: { startMin: dayStart, endMin: dayEnd },
    blocks,
    gaps,
    allDay,
    scheduledMin,
    freeMin: gaps.reduce((sum, gap) => sum + gap.minutes, 0),
    remainingFreeMin: remaining.reduce((sum, gap) => sum + gap.minutes, 0),
    largestRemainingGap:
      remaining.length === 0
        ? null
        : remaining.reduce((best, gap) => (gap.minutes > best.minutes ? gap : best)),
  };
}

export interface PlannedPlacement {
  taskId: string;
  title: string;
  startMin: number;
  endMin: number;
  reason: string;
}

export interface AutoPlanResult {
  placements: PlannedPlacement[];
  skipped: Array<{ title: string; reason: string }>;
  plannedMin: number;
}

/**
 * Fill today's gaps with the highest-ranked unscheduled work that fits,
 * leaving a short break after long stretches. Returns a *proposal* — nothing
 * is written until the caller confirms.
 */
export function autoPlanDay(opts: {
  now: Date;
  model: PlannerModel;
  tasks: Task[];
  schoolDay: boolean;
  /** Do not schedule anything before this minute of the day. */
  fromMin?: number;
}): AutoPlanResult {
  const from = Math.max(opts.fromMin ?? minutesIntoDay(opts.now), opts.model.bounds.startMin);

  const candidates = rankTasks(
    opts.tasks.filter((t) => !t.startAt || dateKey(t.startAt) !== dateKey(opts.now)),
    {
      now: opts.now,
      availableMin: opts.model.freeMin,
      schoolDay: opts.schoolDay,
    },
  );

  const gaps = opts.model.gaps
    .map((gap) => ({ ...gap, cursor: Math.max(gap.startMin, from) }))
    .filter((gap) => gap.endMin - gap.cursor >= MIN_USEFUL_GAP)
    .sort((a, b) => a.cursor - b.cursor);

  const placements: PlannedPlacement[] = [];
  const skipped: AutoPlanResult["skipped"] = [];
  let sinceBreak = 0;

  for (const ranked of candidates) {
    const task = ranked.task;
    const need = Math.max(MIN_SLOT, task.estimateMin);

    // Insert a short break before continuing past 90 minutes of solid work.
    const gap = gaps.find((g) => {
      const needsBreak = sinceBreak >= 90;
      return g.endMin - g.cursor >= need + (needsBreak ? 10 : 0);
    });

    if (!gap) {
      skipped.push({
        title: task.title,
        reason: `Needs ${need} min — no open block that long is left today`,
      });
      continue;
    }

    if (sinceBreak >= 90) {
      gap.cursor += 10;
      sinceBreak = 0;
    }

    placements.push({
      taskId: task.id,
      title: task.title,
      startMin: gap.cursor,
      endMin: gap.cursor + need,
      reason: ranked.reasons[0] ?? "Ranked by priority",
    });
    gap.cursor += need;
    sinceBreak += need;
  }

  return {
    placements,
    skipped: skipped.slice(0, 4),
    plannedMin: placements.reduce((sum, p) => sum + (p.endMin - p.startMin), 0),
  };
}

export function minutesToLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h} ${suffix}` : `${h}:${m < 10 ? `0${m}` : m} ${suffix}`;
}

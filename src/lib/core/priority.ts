/**
 * "Next Move" ranking.
 *
 * The Today page must answer *what should Aadit do next* from real signals, not
 * a hardcoded card. Every input that moves the score also produces a short
 * human-readable reason so the UI can show its work.
 */

import { dayDiff, formatDuration, minutesIntoDay } from "./time";
import type { ISODateTime, Priority, Task, TaskCategory } from "./types";

export interface RankContext {
  now: ISODateTime | Date;
  /** Uninterrupted minutes available before the next commitment. */
  availableMin: number;
  /** True when school is in session today (changes what "school" work is worth). */
  schoolDay: boolean;
  /** Minutes into the day at which school lets out; used for after-school weighting. */
  schoolEndsAtMin?: number | undefined;
}

export interface RankedTask {
  task: Task;
  score: number;
  reasons: string[];
  fitsAvailableTime: boolean;
}

const PRIORITY_WEIGHT: Record<Priority, number> = {
  urgent: 42,
  high: 28,
  normal: 14,
  low: 5,
};

const CATEGORY_BASE: Record<TaskCategory, number> = {
  school: 6,
  work: 5,
  personal: 3,
};

export const RANKABLE_STATUSES = new Set(["todo", "in_progress"]);

/**
 * Urgency curve. Overdue work dominates; work due today is worth far more than
 * work due next week; undated work still gets a small floor so the inbox is
 * never completely invisible.
 */
export function urgencyScore(task: Task, now: Date): number {
  if (!task.dueAt) return 4;
  const due = new Date(task.dueAt);
  const days = dayDiff(now, due);

  if (days < 0) return 100 + Math.min(20, Math.abs(days) * 4);

  if (days === 0) {
    if (task.dueAllDay) return 62;
    const minutesLeft = (due.getTime() - now.getTime()) / 60_000;
    if (minutesLeft <= 0) return 108;
    if (minutesLeft <= 60) return 92;
    if (minutesLeft <= 180) return 78;
    return 66;
  }
  if (days === 1) return 46;
  if (days <= 3) return 32;
  if (days <= 7) return 20;
  if (days <= 14) return 11;
  return 6;
}

/**
 * How well the task fits the time actually available right now.
 * Returns a multiplier-ish delta, not a multiplier, so reasons stay additive.
 */
export function fitScore(task: Task, availableMin: number): number {
  if (availableMin <= 0) return 0;
  const estimate = Math.max(1, task.estimateMin);
  if (estimate <= availableMin) {
    // Prefer tasks that use the window well without overflowing it.
    const utilisation = estimate / availableMin;
    if (utilisation >= 0.5) return 14;
    if (utilisation >= 0.2) return 10;
    return 6;
  }
  const overflow = estimate / availableMin;
  return overflow > 3 ? -22 : -12;
}

export function scoreTask(task: Task, ctx: RankContext): RankedTask {
  const now = typeof ctx.now === "string" ? new Date(ctx.now) : ctx.now;
  const reasons: string[] = [];

  const urgency = urgencyScore(task, now);
  const priority = PRIORITY_WEIGHT[task.priority];
  const fit = fitScore(task, ctx.availableMin);
  const category = CATEGORY_BASE[task.category];

  let score = urgency + priority + fit + category;

  if (task.dueAt) {
    const days = dayDiff(now, task.dueAt);
    if (days < 0)
      reasons.push(`Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`);
    else if (days === 0 && !task.dueAllDay) {
      const minutesLeft = Math.round((new Date(task.dueAt).getTime() - now.getTime()) / 60_000);
      reasons.push(
        minutesLeft <= 0
          ? "Deadline has passed today"
          : minutesLeft < 60
            ? `Due in ${minutesLeft} minutes`
            : `Due in ${Math.round(minutesLeft / 60)} hours`,
      );
    } else if (days === 0) reasons.push("Due today");
    else if (days === 1) reasons.push("Due tomorrow");
    else if (days <= 7) reasons.push(`Due in ${days} days`);
  }

  if (task.priority === "urgent" || task.priority === "high") {
    reasons.push(`${task.priority === "urgent" ? "Urgent" : "High"} priority`);
  }

  const fitsAvailableTime = task.estimateMin <= ctx.availableMin;
  if (ctx.availableMin > 0) {
    reasons.push(
      fitsAvailableTime
        ? `Takes ${formatDuration(task.estimateMin)} of the ${formatDuration(ctx.availableMin)} you have`
        : `Needs ${formatDuration(task.estimateMin)} — more than the ${formatDuration(ctx.availableMin)} you have`,
    );
  } else {
    // With no window left there is nothing to compare against, but the size of
    // the job is still the most useful thing to know about it.
    reasons.push(`Takes ${formatDuration(task.estimateMin)}`);
  }

  if (task.status === "in_progress") {
    score += 8;
    reasons.push("Already in progress");
  }

  if (ctx.schoolDay && task.category === "school") {
    score += 4;
  }

  if (task.subtasks.length > 0) {
    const done = task.subtasks.filter((s) => s.done).length;
    if (done > 0 && done < task.subtasks.length) {
      score += 5;
      reasons.push(`${done} of ${task.subtasks.length} subtasks done`);
    }
  }

  // A five-minute task blocking a whole day is worth clearing first.
  if (task.estimateMin <= 10 && task.dueAt && dayDiff(now, task.dueAt) <= 0) {
    score += 7;
    reasons.push("Quick win");
  }

  // Every branch above is conditional, so a task with no deadline, normal
  // priority and nothing in progress could reach here with nothing to say — and
  // "Next move" with a blank explanation is the one thing this card must never
  // be. Name why it ranked instead of rendering an empty list.
  if (reasons.length === 0) {
    reasons.push(task.dueAt ? "Next by priority" : "No deadline — ranked by priority");
  }

  return { task, score: Math.round(score * 10) / 10, reasons, fitsAvailableTime };
}

export function rankTasks(tasks: Task[], ctx: RankContext): RankedTask[] {
  return tasks
    .filter((t) => RANKABLE_STATUSES.has(t.status) && !t.deletedAt)
    .map((t) => scoreTask(t, ctx))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDue = a.task.dueAt ? new Date(a.task.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.task.dueAt ? new Date(b.task.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return a.task.position - b.task.position;
    });
}

export function nextMove(tasks: Task[], ctx: RankContext): RankedTask | null {
  return rankTasks(tasks, ctx)[0] ?? null;
}

export interface FreeWindow {
  startMin: number;
  endMin: number;
}

/**
 * Minutes of usable focus time left today, given busy blocks and the
 * configured workday. Busy blocks are minute-of-day ranges.
 */
export function availableFocusMinutes(
  busy: FreeWindow[],
  opts: { nowMin: number; dayStartMin: number; dayEndMin: number },
): { totalMin: number; nextWindowMin: number; windows: FreeWindow[] } {
  const from = Math.max(opts.nowMin, opts.dayStartMin);
  const to = opts.dayEndMin;
  if (to <= from) return { totalMin: 0, nextWindowMin: 0, windows: [] };

  const merged = mergeWindows(
    busy
      .map((b) => ({ startMin: Math.max(b.startMin, from), endMin: Math.min(b.endMin, to) }))
      .filter((b) => b.endMin > b.startMin),
  );

  const windows: FreeWindow[] = [];
  let cursor = from;
  for (const block of merged) {
    if (block.startMin > cursor) windows.push({ startMin: cursor, endMin: block.startMin });
    cursor = Math.max(cursor, block.endMin);
  }
  if (cursor < to) windows.push({ startMin: cursor, endMin: to });

  const usable = windows.filter((w) => w.endMin - w.startMin >= 10);
  return {
    totalMin: usable.reduce((sum, w) => sum + (w.endMin - w.startMin), 0),
    nextWindowMin: usable[0] ? usable[0].endMin - usable[0].startMin : 0,
    windows: usable,
  };
}

export function mergeWindows(windows: FreeWindow[]): FreeWindow[] {
  const sorted = [...windows].sort((a, b) => a.startMin - b.startMin);
  const out: FreeWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, w.endMin);
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

export function minutesIntoDayOf(input: ISODateTime | Date): number {
  return minutesIntoDay(input);
}

/**
 * Compass's typed tools.
 *
 * Tools are split into two groups:
 *   READ_TOOLS  — pure functions over the snapshot; safe to run automatically.
 *   WRITE_TOOLS — never mutate anything. They return a *proposal* that the user
 *                 has to confirm in the UI before the client saves it.
 *
 * Every schema is `strict: true` so the model returns arguments that already
 * match these types.
 */

import {
  dayDiff,
  formatTime,
  minutesIntoDay,
  relativeDayLabel,
  zonedParts,
  zonedToUtc,
} from "@/lib/core/time";
import type { TaskDraft } from "@/lib/core/nl-task";
import type { Priority, TaskCategory } from "@/lib/core/types";

import type {
  CompactTask,
  ConflictReport,
  DailyPlan,
  CompassProposal,
  CompassSnapshot,
  CompassToolName,
  PlanBlock,
} from "./types";

export interface ToolDefinition {
  type: "function";
  name: CompassToolName;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
}

/** Strict mode requires every property to be listed in `required`. */
function object(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({
  type: [type, "null"],
  ...extra,
});

export const READ_TOOL_NAMES = [
  "list_tasks",
  "get_task",
  "list_assignments",
  "list_events",
  "list_notes",
  "create_daily_plan",
  "find_schedule_conflicts",
] as const satisfies readonly CompassToolName[];

export const WRITE_TOOL_NAMES = [
  "propose_task",
  "update_task",
] as const satisfies readonly CompassToolName[];

export function isWriteTool(name: string): name is (typeof WRITE_TOOL_NAMES)[number] {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

export const TASK_DRAFT_SCHEMA = object({
  title: { type: "string", description: "Short, action-first title." },
  description: nullable("string"),
  category: { type: "string", enum: ["school", "work", "personal"] },
  courseName: nullable("string", { description: "Must match one of the user's course names." }),
  dueAt: nullable("string", { description: "ISO-8601 instant, e.g. 2026-08-12T18:00:00.000Z." }),
  dueAllDay: { type: "boolean" },
  priority: { type: "string", enum: ["urgent", "high", "normal", "low"] },
  estimateMin: { type: "integer", minimum: 5, maximum: 600 },
  subtasks: { type: "array", items: { type: "string" } },
});

export const COMPASS_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    name: "list_tasks",
    description:
      "List the user's tasks. Use this before answering anything about what is due or what to do.",
    strict: true,
    parameters: object({
      status: nullable("string", { enum: ["todo", "in_progress", "done", "any", null] }),
      category: nullable("string", { enum: ["school", "work", "personal", null] }),
      dueWithinDays: nullable("integer", { minimum: 0, maximum: 60 }),
      courseName: nullable("string"),
      limit: nullable("integer", { minimum: 1, maximum: 50 }),
    }),
  },
  {
    type: "function",
    name: "get_task",
    description: "Fetch one task by id, including its subtasks.",
    strict: true,
    parameters: object({ id: { type: "string" } }),
  },
  {
    type: "function",
    name: "list_assignments",
    description: "List school assignments, optionally filtered by state or course.",
    strict: true,
    parameters: object({
      state: nullable("string", {
        enum: ["assigned", "due_soon", "missing", "submitted", "graded", null],
      }),
      courseName: nullable("string"),
      dueWithinDays: nullable("integer", { minimum: 0, maximum: 60 }),
    }),
  },
  {
    type: "function",
    name: "list_events",
    description:
      "List calendar events (classes, school events, meetings) in a day range relative to today.",
    strict: true,
    parameters: object({
      fromDays: nullable("integer", { minimum: -7, maximum: 30 }),
      toDays: nullable("integer", { minimum: -7, maximum: 30 }),
    }),
  },
  {
    type: "function",
    name: "list_notes",
    description:
      "Read the user's own notes — thoughts and ideas they wrote about a class. Call this before advising on a class, an assignment or what to work on: notes carry what the teacher actually asked for and where the user got stuck, which no deadline shows.",
    strict: true,
    parameters: object({
      courseName: nullable("string"),
      kind: nullable("string", { enum: ["thought", "idea", null] }),
      limit: nullable("integer", { minimum: 1, maximum: 40 }),
    }),
  },
  {
    type: "function",
    name: "create_daily_plan",
    description:
      "Build a concrete time-blocked plan from the highest-value open tasks that fit the available time.",
    strict: true,
    parameters: object({
      availableMin: nullable("integer", { minimum: 15, maximum: 720 }),
      startAt: nullable("string", { description: "ISO instant to start from. Defaults to now." }),
      focus: nullable("string", { enum: ["school", "work", "personal", "balanced", null] }),
    }),
  },
  {
    type: "function",
    name: "find_schedule_conflicts",
    description: "Find overlapping calendar events in the next N days.",
    strict: true,
    parameters: object({ days: nullable("integer", { minimum: 1, maximum: 30 }) }),
  },
  {
    type: "function",
    name: "propose_task",
    description:
      "Propose a new task. This does NOT save anything — the user must confirm it in the UI.",
    strict: true,
    parameters: TASK_DRAFT_SCHEMA,
  },
  {
    type: "function",
    name: "update_task",
    description:
      "Propose a change to an existing task. This does NOT save anything — the user must confirm it.",
    strict: true,
    parameters: object({
      taskId: { type: "string" },
      title: nullable("string"),
      priority: nullable("string", { enum: ["urgent", "high", "normal", "low", null] }),
      status: nullable("string", { enum: ["todo", "in_progress", "done", null] }),
      dueAt: nullable("string"),
      estimateMin: nullable("integer", { minimum: 5, maximum: 600 }),
    }),
  },
];

export interface ToolOutcome {
  data: unknown;
  proposal?: CompassProposal | undefined;
}

type Args = Record<string, unknown>;

function str(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function int(args: Args, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

const OPEN = new Set(["todo", "in_progress"]);

/** Execute a tool against the snapshot. Pure — safe to unit test. */
export function runTool(
  name: CompassToolName,
  rawArgs: unknown,
  snap: CompassSnapshot,
): ToolOutcome {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Args;
  const now = new Date(snap.now);

  switch (name) {
    case "list_tasks": {
      const status = str(args, "status") ?? "open";
      const category = str(args, "category");
      const within = int(args, "dueWithinDays");
      const course = str(args, "courseName")?.toLowerCase();
      const limit = int(args, "limit") ?? 20;

      const filtered = snap.tasks.filter((t) => {
        if (status === "any") {
          /* keep */
        } else if (status === "open") {
          if (!OPEN.has(t.status)) return false;
        } else if (t.status !== status) return false;
        if (category && t.category !== category) return false;
        if (course && (t.course ?? "").toLowerCase() !== course) return false;
        if (within !== undefined) {
          if (!t.dueAt) return false;
          const diff = dayDiff(now, t.dueAt);
          if (diff > within) return false;
        }
        return true;
      });
      return { data: { tasks: filtered.slice(0, limit), total: filtered.length } };
    }

    case "get_task": {
      const id = str(args, "id");
      const task = snap.tasks.find((t) => t.id === id);
      return { data: task ? { task } : { error: "not_found", id } };
    }

    case "list_assignments": {
      const state = str(args, "state");
      const course = str(args, "courseName")?.toLowerCase();
      const within = int(args, "dueWithinDays");
      const filtered = snap.assignments.filter((a) => {
        if (state && a.state !== state) return false;
        if (course && (a.course ?? "").toLowerCase() !== course) return false;
        if (within !== undefined) {
          if (!a.dueAt) return false;
          if (dayDiff(now, a.dueAt) > within) return false;
        }
        return true;
      });
      return { data: { assignments: filtered, total: filtered.length } };
    }

    case "list_events": {
      const from = int(args, "fromDays") ?? 0;
      const to = int(args, "toDays") ?? 7;
      const filtered = snap.events.filter((e) => {
        const diff = dayDiff(now, e.startAt);
        return diff >= from && diff <= to;
      });
      return { data: { events: filtered, total: filtered.length } };
    }

    case "list_notes": {
      const course = str(args, "courseName")?.toLowerCase();
      const kind = str(args, "kind");
      const limit = int(args, "limit") ?? 20;
      const filtered = snap.notes.filter((n) => {
        if (course && (n.course ?? "").toLowerCase() !== course) return false;
        if (kind && n.kind !== kind) return false;
        return true;
      });
      return { data: { notes: filtered.slice(0, limit), total: filtered.length } };
    }

    case "create_daily_plan":
      return { data: buildDailyPlan(snap, args) };

    case "find_schedule_conflicts": {
      const days = int(args, "days") ?? 7;
      const report: ConflictReport = { conflicts: [], checkedDays: days };
      const timed = snap.events
        .filter(
          (e) =>
            !e.allDay && e.endAt && dayDiff(now, e.startAt) <= days && dayDiff(now, e.startAt) >= 0,
        )
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      for (let i = 0; i < timed.length; i += 1) {
        for (let j = i + 1; j < timed.length; j += 1) {
          const a = timed[i]!;
          const b = timed[j]!;
          const aStart = new Date(a.startAt).getTime();
          const aEnd = new Date(a.endAt!).getTime();
          const bStart = new Date(b.startAt).getTime();
          const bEnd = new Date(b.endAt!).getTime();
          if (bStart >= aEnd) break;
          const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
          if (overlap > 0) {
            report.conflicts.push({
              aTitle: a.title,
              bTitle: b.title,
              startAt: new Date(Math.max(aStart, bStart)).toISOString(),
              overlapMin: Math.round(overlap / 60_000),
            });
          }
        }
      }
      return { data: report };
    }

    case "propose_task": {
      const draft: TaskDraft = {
        title: str(args, "title") ?? "Untitled task",
        category: (str(args, "category") ?? "personal") as TaskCategory,
        priority: (str(args, "priority") ?? "normal") as Priority,
        estimateMin: int(args, "estimateMin") ?? 30,
        dueAllDay: args["dueAllDay"] === true,
      };
      const description = str(args, "description");
      if (description) draft.description = description;
      const dueAt = str(args, "dueAt");
      if (dueAt && !Number.isNaN(new Date(dueAt).getTime()))
        draft.dueAt = new Date(dueAt).toISOString();
      const courseName = str(args, "courseName");
      if (courseName && snap.courses.includes(courseName)) draft.courseName = courseName;
      const subtasks = args["subtasks"];
      if (Array.isArray(subtasks) && subtasks.length > 0) {
        draft.subtasks = subtasks.filter((s): s is string => typeof s === "string").slice(0, 12);
      }
      const proposal: CompassProposal = {
        tool: "propose_task",
        summary: `Create "${draft.title}"${draft.dueAt ? ` due ${relativeDayLabel(draft.dueAt, now)}` : ""} · ${draft.estimateMin} min`,
        draft,
      };
      return { data: { status: "awaiting_confirmation", draft }, proposal };
    }

    case "update_task": {
      const taskId = str(args, "taskId") ?? "";
      const task = snap.tasks.find((t) => t.id === taskId);
      if (!task) return { data: { error: "not_found", taskId } };
      const patch: Record<string, unknown> = {};
      const title = str(args, "title");
      if (title) patch["title"] = title;
      const priority = str(args, "priority");
      if (priority) patch["priority"] = priority;
      const status = str(args, "status");
      if (status) patch["status"] = status;
      const dueAt = str(args, "dueAt");
      if (dueAt && !Number.isNaN(new Date(dueAt).getTime())) {
        patch["dueAt"] = new Date(dueAt).toISOString();
      }
      const estimateMin = int(args, "estimateMin");
      if (estimateMin) patch["estimateMin"] = estimateMin;

      if (Object.keys(patch).length === 0) {
        return { data: { error: "no_changes", taskId } };
      }
      const proposal: CompassProposal = {
        tool: "update_task",
        summary: `Update "${task.title}": ${describePatch(patch, now)}`,
        update: { taskId, title: task.title, patch },
      };
      return { data: { status: "awaiting_confirmation", taskId, patch }, proposal };
    }

    default:
      return { data: { error: "unknown_tool", name } };
  }
}

function describePatch(patch: Record<string, unknown>, now: Date): string {
  return Object.entries(patch)
    .map(([key, value]) => {
      if (key === "dueAt" && typeof value === "string") {
        return `due ${relativeDayLabel(value, now)} at ${formatTime(value)}`;
      }
      if (key === "estimateMin") return `estimate ${String(value)} min`;
      return `${key} → ${String(value)}`;
    })
    .join(", ");
}

const SCORE_BONUS: Record<Priority, number> = { urgent: 40, high: 25, normal: 12, low: 4 };

export function buildDailyPlan(snap: CompassSnapshot, args: Args = {}): DailyPlan {
  const now = new Date(snap.now);
  const startArg = typeof args["startAt"] === "string" ? new Date(args["startAt"] as string) : null;
  const start = startArg && !Number.isNaN(startArg.getTime()) ? startArg : now;
  const available = int(args, "availableMin") ?? snap.availableMin ?? 120;
  const focus = (typeof args["focus"] === "string" ? args["focus"] : "balanced") as string;

  const candidates = snap.tasks
    .filter((t) => OPEN.has(t.status))
    .filter((t) => (focus === "balanced" || !focus ? true : t.category === focus))
    .map((t) => ({ task: t, score: planScore(t, now) }))
    .sort((a, b) => b.score - a.score);

  const blocks: PlanBlock[] = [];
  const skipped: DailyPlan["skipped"] = [];
  let cursor = new Date(start);
  let used = 0;
  let sinceBreak = 0;

  for (const { task } of candidates) {
    const remaining = available - used;
    if (remaining < 10) break;
    if (task.estimateMin > remaining) {
      skipped.push({
        title: task.title,
        reason: `Needs ${task.estimateMin} min, only ${remaining} min left`,
      });
      continue;
    }
    if (sinceBreak >= 90) {
      const breakEnd = new Date(cursor.getTime() + 10 * 60_000);
      blocks.push({
        startAt: cursor.toISOString(),
        endAt: breakEnd.toISOString(),
        title: "Break",
        minutes: 10,
        reason: "You have been working for 90 minutes",
        category: "break",
      });
      cursor = breakEnd;
      used += 10;
      sinceBreak = 0;
      continue;
    }

    const end = new Date(cursor.getTime() + task.estimateMin * 60_000);
    blocks.push({
      startAt: cursor.toISOString(),
      endAt: end.toISOString(),
      taskId: task.id,
      title: task.title,
      minutes: task.estimateMin,
      reason: planReason(task, now),
      category: task.category,
    });
    cursor = end;
    used += task.estimateMin;
    sinceBreak += task.estimateMin;
  }

  const workBlocks = blocks.filter((b) => b.category !== "break");
  return {
    summary: workBlocks.length
      ? `${workBlocks.length} task${workBlocks.length === 1 ? "" : "s"} in ${used} minutes, starting ${formatTime(start)}.`
      : "Nothing fits the time available right now.",
    totalMinutes: used,
    blocks,
    skipped: skipped.slice(0, 5),
  };
}

function planScore(task: CompactTask, now: Date): number {
  let score = SCORE_BONUS[task.priority];
  if (task.dueAt) {
    const diff = dayDiff(now, task.dueAt);
    if (diff < 0) score += 100;
    else if (diff === 0) score += 70;
    else if (diff === 1) score += 45;
    else if (diff <= 7) score += 20;
    else score += 6;
  } else {
    score += 3;
  }
  if (task.status === "in_progress") score += 8;
  if (task.subtasksOpen > 0) score += 3;
  return score;
}

function planReason(task: CompactTask, now: Date): string {
  if (!task.dueAt) return `${task.priority} priority · no due date`;
  const diff = dayDiff(now, task.dueAt);
  if (diff < 0) return `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"}`;
  if (diff === 0) return task.dueAllDay ? "Due today" : `Due today at ${formatTime(task.dueAt)}`;
  if (diff === 1) return "Due tomorrow";
  return `Due in ${diff} days`;
}

/** Local time-of-day helpers reused by the plan renderer. */
export function planWindowLabel(startAt: string, endAt: string): string {
  return `${formatTime(startAt)} – ${formatTime(endAt)}`;
}

export function todayMinuteRange(now: Date): { startMin: number; endMin: number } {
  const p = zonedParts(now);
  return {
    startMin: minutesIntoDay(zonedToUtc(p.year, p.month, p.day, 0, 0)),
    endMin: 24 * 60,
  };
}

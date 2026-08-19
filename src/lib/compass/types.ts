/** Wire types shared by the assistant client and the `/api/compass` server route. */

import type { TaskDraft } from "@/lib/core/nl-task";
import type { Priority, TaskCategory } from "@/lib/core/types";

export interface CompactTask {
  id: string;
  title: string;
  category: TaskCategory;
  priority: Priority;
  status: string;
  estimateMin: number;
  dueAt?: string | undefined;
  dueAllDay: boolean;
  course?: string | undefined;
  subtasksOpen: number;
}

export interface CompactAssignment {
  id: string;
  title: string;
  course?: string | undefined;
  state: string;
  dueAt?: string | undefined;
  estimateMin: number;
  grade?: string | undefined;
  url?: string | undefined;
}

export interface CompactEvent {
  id: string;
  title: string;
  startAt: string;
  endAt?: string | undefined;
  allDay: boolean;
  kind: string;
  source: string;
  location?: string | undefined;
}

/**
 * A note the assistant can read.
 *
 * Notes are the part of the workspace that carries intent rather than
 * schedule — what a teacher actually wants, what the user was stuck on, what
 * they thought of doing. Without them the assistant can only ever answer from
 * deadlines, which is the shallow half of the question.
 */
export interface CompactNote {
  id: string;
  course?: string | undefined;
  kind: string;
  body: string;
  createdAt: string;
  madeIntoTask: boolean;
}

export interface CompassSnapshot {
  now: string;
  timezone: string;
  profile: { name: string; grade: string; school: string; city: string };
  schoolDay: { isSchoolDay: boolean; reason: string; nextClass?: string | undefined };
  availableMin: number;
  tasks: CompactTask[];
  assignments: CompactAssignment[];
  events: CompactEvent[];
  notes: CompactNote[];
  courses: string[];
  isDemo: boolean;
}

export interface CompassMessage {
  role: "user" | "assistant";
  content: string;
}

// ---- renderable tool payloads -------------------------------------------

export interface PlanBlock {
  startAt: string;
  endAt: string;
  taskId?: string | undefined;
  title: string;
  minutes: number;
  reason: string;
  category: TaskCategory | "break";
}

export interface DailyPlan {
  summary: string;
  totalMinutes: number;
  blocks: PlanBlock[];
  skipped: Array<{ title: string; reason: string }>;
}

export interface ConflictReport {
  conflicts: Array<{
    aTitle: string;
    bTitle: string;
    startAt: string;
    overlapMin: number;
  }>;
  checkedDays: number;
}

export type CompassToolName =
  | "list_tasks"
  | "get_task"
  | "list_assignments"
  | "list_events"
  | "list_notes"
  | "create_daily_plan"
  | "find_schedule_conflicts"
  | "propose_task"
  | "update_task";

export interface CompassProposal {
  tool: "propose_task" | "update_task";
  /** Human sentence describing exactly what will change. */
  summary: string;
  draft?: TaskDraft | undefined;
  update?: { taskId: string; title: string; patch: Record<string, unknown> } | undefined;
}

export type CompassEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: CompassToolName; status: "running" }
  | { type: "tool_result"; name: CompassToolName; data: unknown }
  | { type: "proposal"; proposal: CompassProposal }
  | { type: "done"; usage?: { inputTokens: number; outputTokens: number } | undefined }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface CompassRequestBody {
  messages: CompassMessage[];
  snapshot: CompassSnapshot;
  clientId: string;
}

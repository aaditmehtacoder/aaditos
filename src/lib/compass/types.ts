/** Wire types shared by the Compass client and the `/api/compass` server route. */

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
  project?: string | undefined;
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

export interface CompactProject {
  id: string;
  name: string;
  objective: string;
  health: string;
  progress: number;
  blockers: string[];
  deadlineAt?: string | undefined;
  openTasks: number;
  recentActivity: string[];
}

export interface CompactOpportunity {
  id: string;
  org: string;
  title: string;
  type: string;
  stage: string;
  deadlineAt?: string | undefined;
  nextAction?: string | undefined;
}

export interface CompactFocus {
  last7DaysMin: number;
  byCategory: Record<string, number>;
  sessionCount: number;
  longestSessionMin: number;
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
  projects: CompactProject[];
  opportunities: CompactOpportunity[];
  focus: CompactFocus;
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

export interface FocusSummaryPayload {
  days: number;
  totalMin: number;
  sessionCount: number;
  byCategory: Array<{ category: string; minutes: number }>;
  plannedVsCompleted: { plannedMin: number; completedMin: number };
  mostProductiveHour?: string | undefined;
}

export interface ProjectStatusPayload {
  id: string;
  name: string;
  health: string;
  progress: number;
  objective: string;
  blockers: string[];
  nextActions: string[];
  deadlineAt?: string | undefined;
  recentActivity: string[];
}

export type CompassToolName =
  | "list_tasks"
  | "get_task"
  | "list_assignments"
  | "list_events"
  | "list_projects"
  | "get_project_status"
  | "list_opportunities"
  | "create_daily_plan"
  | "find_schedule_conflicts"
  | "get_focus_summary"
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
  tone: "concise" | "coach" | "detailed";
  clientId: string;
}

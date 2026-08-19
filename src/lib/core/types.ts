/**
 * AaditOS domain model.
 *
 * Four things exist: tasks, classes (with their assignments), events, and
 * notes. Everything on screen is one of those. Every record carries `userId`
 * so the same shapes work against Row-Level-Security-protected Postgres
 * tables without a rewrite.
 */

export type UUID = string;

/** ISO-8601 instant, always stored in UTC. */
export type ISODateTime = string;
/** ISO-8601 calendar date (`YYYY-MM-DD`) in America/Los_Angeles. */
export type ISODate = string;

export const SOURCES = ["manual", "google_classroom", "google_calendar", "wilcox", "demo"] as const;
export type SourceId = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<SourceId, string> = {
  manual: "Added by you",
  google_classroom: "Classroom",
  google_calendar: "Calendar",
  wilcox: "Wilcox",
  demo: "Demo",
};

export type Priority = "urgent" | "high" | "normal" | "low";
export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];

export type TaskCategory = "school" | "work" | "personal";
export const TASK_CATEGORIES: TaskCategory[] = ["school", "work", "personal"];

export type TaskStatus = "todo" | "in_progress" | "done" | "archived";

export interface Subtask {
  id: UUID;
  title: string;
  done: boolean;
  position: number;
}

export interface Task {
  id: UUID;
  userId: UUID;
  title: string;
  description?: string | undefined;
  category: TaskCategory;
  courseId?: UUID | undefined;
  /** ISO instant the task is due, or undefined for someday/inbox items. */
  dueAt?: ISODateTime | undefined;
  /** True when `dueAt` carries no meaningful clock time. */
  dueAllDay: boolean;
  startAt?: ISODateTime | undefined;
  priority: Priority;
  status: TaskStatus;
  estimateMin: number;
  actualMin?: number | undefined;
  source: SourceId;
  /** Stable id from the origin system; used to make imports idempotent. */
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
  notes?: string | undefined;
  subtasks: Subtask[];
  position: number;
  completedAt?: ISODateTime | undefined;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime | undefined;
}

export interface Course {
  id: UUID;
  userId: UUID;
  name: string;
  teacher?: string | undefined;
  room?: string | undefined;
  period?: number | undefined;
  color: string;
  grade?: string | undefined;
  source: SourceId;
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
  active: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type AssignmentState = "assigned" | "due_soon" | "missing" | "submitted" | "graded";

export const ASSIGNMENT_STATES: AssignmentState[] = [
  "assigned",
  "due_soon",
  "missing",
  "submitted",
  "graded",
];

export interface Assignment {
  id: UUID;
  userId: UUID;
  courseId?: UUID | undefined;
  title: string;
  description?: string | undefined;
  dueAt?: ISODateTime | undefined;
  dueAllDay: boolean;
  state: AssignmentState;
  estimateMin: number;
  points?: number | undefined;
  grade?: string | undefined;
  source: SourceId;
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type EventKind =
  | "class"
  | "assignment"
  | "meeting"
  | "school"
  | "district"
  | "counseling"
  | "athletics"
  | "personal";

export interface CalendarEvent {
  id: UUID;
  userId: UUID;
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  startAt: ISODateTime;
  endAt?: ISODateTime | undefined;
  allDay: boolean;
  kind: EventKind;
  source: SourceId;
  /** Calendar feed within the source, e.g. `wilcox:athletics`. */
  calendarId: string;
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/**
 * A thought or an idea, attached to a class.
 *
 * This is the thing a planner normally has nowhere to put: "Robson said the
 * essay thesis has to be arguable", or "what if I wrote the Financial Lit
 * project about Origami Prep's pricing". Neither is a task and neither has a
 * date, so a todo list either loses it or turns it into a fake deadline.
 *
 * A note becomes a task only when the user says so — `taskId` records that it
 * did, so the same idea is never turned into two tasks.
 */
export type NoteKind = "thought" | "idea";
export const NOTE_KINDS: NoteKind[] = ["thought", "idea"];

export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  thought: "Thought",
  idea: "Idea",
};

export interface Note {
  id: UUID;
  userId: UUID;
  /** The class this belongs to. Undefined means it is not about a class. */
  courseId?: UUID | undefined;
  kind: NoteKind;
  body: string;
  /** Set once this note has been turned into a task, so it is only done once. */
  taskId?: UUID | undefined;
  pinned: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type IntegrationStatus = "connected" | "disconnected" | "error" | "unavailable" | "demo";

export interface IntegrationRecord {
  id: string;
  userId: UUID;
  status: IntegrationStatus;
  lastSyncAt?: ISODateTime | undefined;
  lastError?: string | undefined;
  /** Non-secret metadata only — tokens never reach the client. */
  meta: Record<string, string>;
  updatedAt: ISODateTime;
}

export interface SyncRun {
  id: UUID;
  userId: UUID;
  provider: string;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime | undefined;
  ok: boolean;
  imported: number;
  updated: number;
  skipped: number;
  message?: string | undefined;
}

export interface UserPreferences {
  userId: UUID;
  theme: "light" | "dark" | "system";
  workdayStart: string;
  workdayEnd: string;
  reducedMotion: boolean;
  updatedAt: ISODateTime;
}

export interface Profile {
  id: UUID;
  email: string;
  name: string;
  avatarUrl?: string | undefined;
  school: string;
  grade: string;
  city: string;
  timezone: string;
}

/** Everything the UI needs for one signed-in person. */
export interface Workspace {
  profile: Profile;
  preferences: UserPreferences;
  tasks: Task[];
  courses: Course[];
  assignments: Assignment[];
  events: CalendarEvent[];
  notes: Note[];
  integrations: IntegrationRecord[];
  syncRuns: SyncRun[];
}

/**
 * AaditOS domain model.
 *
 * These types are the contract between the UI, the repository layer and the
 * server-side integration adapters. Every record that belongs to a person
 * carries `userId` so the same shapes work against Row-Level-Security-protected
 * Postgres tables without a rewrite.
 */

export type UUID = string;

/** ISO-8601 instant, always stored in UTC. */
export type ISODateTime = string;
/** ISO-8601 calendar date (`YYYY-MM-DD`) in America/Los_Angeles. */
export type ISODate = string;

export const SOURCES = [
  "manual",
  "google_classroom",
  "google_calendar",
  "gmail",
  "google_drive",
  "github",
  "vercel",
  "spotify",
  "wilcox",
  "aeries",
  "discord",
  "linkedin",
  "demo",
] as const;
export type SourceId = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<SourceId, string> = {
  manual: "Manual",
  google_classroom: "Classroom",
  google_calendar: "Calendar",
  gmail: "Gmail",
  google_drive: "Drive",
  github: "GitHub",
  vercel: "Vercel",
  spotify: "Spotify",
  wilcox: "Wilcox",
  aeries: "Aeries",
  discord: "Discord",
  linkedin: "LinkedIn",
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
  projectId?: string | undefined;
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
  | "personal"
  | "focus";

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

export type ProjectHealth = "on_track" | "attention" | "at_risk";

export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectActivity {
  id: string;
  at: ISODateTime;
  text: string;
  source: SourceId;
  url?: string | undefined;
}

export interface ProjectMetric {
  label: string;
  value: string;
  delta?: string | undefined;
}

export interface ProjectDocument {
  name: string;
  meta: string;
  url?: string | undefined;
}

export interface Project {
  id: string;
  userId: UUID;
  name: string;
  kind: string;
  objective: string;
  progress: number;
  health: ProjectHealth;
  blockers: string[];
  deadlineAt?: ISODateTime | undefined;
  deadlineLabel?: string | undefined;
  contact?: string | undefined;
  githubRepo?: string | undefined;
  vercelProject?: string | undefined;
  links: ProjectLink[];
  metrics: ProjectMetric[];
  documents: ProjectDocument[];
  activity: ProjectActivity[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export const OPPORTUNITY_STAGES = [
  "discovered",
  "interested",
  "applied",
  "follow_up",
  "interview",
  "accepted",
  "closed",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  discovered: "Discovered",
  interested: "Interested",
  applied: "Applied",
  follow_up: "Follow-up",
  interview: "Interview",
  accepted: "Accepted",
  closed: "Closed",
};

export const OPPORTUNITY_TYPES = [
  "internship",
  "hackathon",
  "founder",
  "sponsorship",
  "application",
  "event",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  internship: "Internship",
  hackathon: "Hackathon",
  founder: "Founder",
  sponsorship: "Sponsorship",
  application: "Application",
  event: "Event",
};

export interface Opportunity {
  id: UUID;
  userId: UUID;
  org: string;
  title: string;
  type: OpportunityType;
  stage: OpportunityStage;
  contact?: string | undefined;
  deadlineAt?: ISODateTime | undefined;
  lastInteractionAt?: ISODateTime | undefined;
  lastInteractionNote?: string | undefined;
  nextAction?: string | undefined;
  notes?: string | undefined;
  relatedEmail?: string | undefined;
  relatedUrl?: string | undefined;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type FocusSessionStatus = "running" | "paused" | "completed" | "cancelled";

export interface FocusSession {
  id: UUID;
  userId: UUID;
  taskId?: UUID | undefined;
  taskTitle: string;
  category: TaskCategory;
  plannedMin: number;
  /** Accumulated elapsed seconds, excluding time spent paused. */
  elapsedSec: number;
  status: FocusSessionStatus;
  startedAt: ISODateTime;
  /** Set while `status === "running"`; the instant the current run leg began. */
  resumedAt?: ISODateTime | undefined;
  endedAt?: ISODateTime | undefined;
  reflection?: string | undefined;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type NotificationCategory = "urgent" | "school" | "projects" | "opportunities" | "system";

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "urgent",
  "school",
  "projects",
  "opportunities",
  "system",
];

export interface AppNotification {
  id: UUID;
  userId: UUID;
  category: NotificationCategory;
  title: string;
  detail?: string | undefined;
  source: SourceId;
  href?: string | undefined;
  externalUrl?: string | undefined;
  read: boolean;
  createdAt: ISODateTime;
  /** Stable key so repeated syncs never duplicate a notification. */
  dedupeKey: string;
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
  focusGoalHours: number;
  weeklyTaskGoal: number;
  workdayStart: string;
  workdayEnd: string;
  mutedNotificationCategories: NotificationCategory[];
  browserNotifications: boolean;
  compassTone: "concise" | "coach" | "detailed";
  compassAutoRunReadTools: boolean;
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
  projects: Project[];
  opportunities: Opportunity[];
  focusSessions: FocusSession[];
  notifications: AppNotification[];
  integrations: IntegrationRecord[];
  syncRuns: SyncRun[];
}

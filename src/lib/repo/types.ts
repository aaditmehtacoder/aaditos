/**
 * Repository contract.
 *
 * The UI only ever talks to this interface. `LocalRepository` (browser storage)
 * and `SupabaseRepository` (Postgres + RLS) both implement it, so switching
 * persistence is a configuration change rather than a rewrite.
 */

import type {
  AppNotification,
  Assignment,
  CalendarEvent,
  Course,
  FocusSession,
  IntegrationRecord,
  Opportunity,
  Project,
  SyncRun,
  Task,
  UserPreferences,
  UUID,
  Workspace,
} from "@/lib/core/types";

export type RepositoryKind = "local" | "supabase";

export interface TaskInput {
  title: string;
  description?: string | undefined;
  category: Task["category"];
  courseId?: UUID | undefined;
  projectId?: string | undefined;
  dueAt?: string | undefined;
  dueAllDay?: boolean | undefined;
  startAt?: string | undefined;
  priority?: Task["priority"] | undefined;
  status?: Task["status"] | undefined;
  estimateMin?: number | undefined;
  source?: Task["source"] | undefined;
  sourceRef?: string | undefined;
  externalUrl?: string | undefined;
  notes?: string | undefined;
  subtasks?: Array<{ title: string; done?: boolean }> | undefined;
}

export interface OpportunityInput {
  org: string;
  title: string;
  type: Opportunity["type"];
  stage?: Opportunity["stage"] | undefined;
  contact?: string | undefined;
  deadlineAt?: string | undefined;
  nextAction?: string | undefined;
  notes?: string | undefined;
  relatedEmail?: string | undefined;
  relatedUrl?: string | undefined;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

export interface Repository {
  readonly kind: RepositoryKind;

  loadWorkspace(userId: UUID): Promise<Workspace>;

  createTask(userId: UUID, input: TaskInput): Promise<Task>;
  updateTask(userId: UUID, id: UUID, patch: Partial<Task>): Promise<Task>;
  deleteTask(userId: UUID, id: UUID): Promise<void>;
  reorderTasks(userId: UUID, orderedIds: UUID[]): Promise<void>;

  saveFocusSession(userId: UUID, session: FocusSession): Promise<FocusSession>;

  createOpportunity(userId: UUID, input: OpportunityInput): Promise<Opportunity>;
  updateOpportunity(userId: UUID, id: UUID, patch: Partial<Opportunity>): Promise<Opportunity>;
  deleteOpportunity(userId: UUID, id: UUID): Promise<void>;

  upsertNotifications(userId: UUID, items: AppNotification[]): Promise<ImportResult>;
  updateNotification(
    userId: UUID,
    id: UUID,
    patch: Partial<AppNotification>,
  ): Promise<AppNotification>;
  markAllNotificationsRead(userId: UUID): Promise<void>;

  upsertCourses(userId: UUID, items: Course[]): Promise<ImportResult>;
  upsertAssignments(userId: UUID, items: Assignment[]): Promise<ImportResult>;
  /** Replace every event belonging to `calendarIds` with `items` (idempotent import). */
  replaceEvents(userId: UUID, calendarIds: string[], items: CalendarEvent[]): Promise<ImportResult>;
  upsertProjects(userId: UUID, items: Project[]): Promise<ImportResult>;

  upsertIntegration(userId: UUID, record: IntegrationRecord): Promise<IntegrationRecord>;
  recordSyncRun(userId: UUID, run: SyncRun): Promise<void>;

  savePreferences(userId: UUID, prefs: UserPreferences): Promise<UserPreferences>;

  exportWorkspace(userId: UUID): Promise<Workspace>;
  resetToDemoData(userId: UUID): Promise<Workspace>;
  deleteAllData(userId: UUID): Promise<void>;
}

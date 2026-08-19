/**
 * Repository contract.
 *
 * The UI only ever talks to this interface. `LocalRepository` (browser storage)
 * and `SupabaseRepository` (Postgres + RLS) both implement it, so switching
 * persistence is a configuration change rather than a rewrite.
 */

import type {
  Assignment,
  CalendarEvent,
  Course,
  IntegrationRecord,
  Note,
  NoteKind,
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

export interface NoteInput {
  courseId?: UUID | undefined;
  kind?: NoteKind | undefined;
  body: string;
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

  createNote(userId: UUID, input: NoteInput): Promise<Note>;
  updateNote(userId: UUID, id: UUID, patch: Partial<Note>): Promise<Note>;
  deleteNote(userId: UUID, id: UUID): Promise<void>;

  upsertCourses(userId: UUID, items: Course[]): Promise<ImportResult>;
  upsertAssignments(userId: UUID, items: Assignment[]): Promise<ImportResult>;
  /** Replace every event belonging to `calendarIds` with `items` (idempotent import). */
  replaceEvents(userId: UUID, calendarIds: string[], items: CalendarEvent[]): Promise<ImportResult>;

  upsertIntegration(userId: UUID, record: IntegrationRecord): Promise<IntegrationRecord>;
  recordSyncRun(userId: UUID, run: SyncRun): Promise<void>;

  savePreferences(userId: UUID, prefs: UserPreferences): Promise<UserPreferences>;

  exportWorkspace(userId: UUID): Promise<Workspace>;
  deleteAllData(userId: UUID): Promise<void>;
}

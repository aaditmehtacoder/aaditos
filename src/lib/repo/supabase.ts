/**
 * Supabase-backed repository.
 *
 * Every table is protected by Row Level Security (see
 * `supabase/migrations/0001_init.sql`), so this client only ever uses the anon
 * key and the signed-in user's JWT — the database, not this file, is what
 * prevents cross-user reads.
 *
 * Requires the migrations to be applied to the linked project. When Supabase is
 * not configured the app uses `LocalRepository` instead.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { getSupabase } from "@/lib/auth/client";
import { nowISO } from "@/lib/core/time";
import type {
  Assignment,
  CalendarEvent,
  Course,
  IntegrationRecord,
  Note,
  Profile,
  SyncRun,
  Task,
  UserPreferences,
  UUID,
  Workspace,
} from "@/lib/core/types";

import { defaultPreferences, seedCourses } from "./seed";
import type { ImportResult, NoteInput, Repository, TaskInput } from "./types";

type Row = Record<string, unknown>;

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured in this environment.");
    this.name = "SupabaseNotConfiguredError";
  }
}

function check<T>(data: T | null, error: PostgrestError | null, what: string): T {
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data === null) throw new Error(`${what}: no data returned`);
  return data;
}

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;

  constructor(private readonly profileFor: () => Profile) {}

  private db(): SupabaseClient {
    const client = getSupabase();
    if (!client) throw new SupabaseNotConfiguredError();
    return client;
  }

  async loadWorkspace(userId: UUID): Promise<Workspace> {
    const db = this.db();
    const [tasks, courses, assignments, events, notes, integrations, syncRuns, preferences] =
      await Promise.all([
        db.from("tasks").select("*").eq("user_id", userId).is("deleted_at", null),
        db.from("courses").select("*").eq("user_id", userId),
        db.from("assignments").select("*").eq("user_id", userId),
        db.from("events").select("*").eq("user_id", userId),
        db
          .from("notes")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        db.from("integrations").select("*").eq("user_id", userId),
        db
          .from("sync_runs")
          .select("*")
          .eq("user_id", userId)
          .order("started_at", { ascending: false })
          .limit(50),
        db.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
      ]);

    // First run for this account: the class schedule is fixed and known, so
    // write it once rather than leaving School and "next class" empty until the
    // user types eight courses in by hand.
    //
    // This is a convenience, so it must never be able to block sign-in. A failed
    // seed used to reject the whole `loadWorkspace` promise, which rendered
    // "Could not load your workspace" and locked the user out of an account whose
    // tasks, events and projects had all loaded fine. Now the failure costs
    // exactly what it should: the schedule is missing until the next load.
    let courseRows = check(courses.data, courses.error, "load courses").map(courseFromRow);
    if (courseRows.length === 0) {
      const seeded = seedCourses(userId, new Date());
      try {
        await this.upsertCourses(userId, seeded);
        courseRows = seeded;
      } catch (error) {
        console.error("[supabase] seeding the class schedule failed", {
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    return {
      profile: this.profileFor(),
      preferences: preferences.data
        ? preferencesFromRow(preferences.data as Row, userId)
        : defaultPreferences(userId),
      tasks: check(tasks.data, tasks.error, "load tasks").map(taskFromRow),
      courses: courseRows,
      assignments: check(assignments.data, assignments.error, "load assignments").map(
        assignmentFromRow,
      ),
      events: check(events.data, events.error, "load events").map(eventFromRow),
      notes: check(notes.data, notes.error, "load notes").map(noteFromRow),
      integrations: check(integrations.data, integrations.error, "load integrations").map(
        integrationFromRow,
      ),
      syncRuns: check(syncRuns.data, syncRuns.error, "load sync runs").map(syncRunFromRow),
    };
  }

  async createTask(userId: UUID, input: TaskInput): Promise<Task> {
    const db = this.db();
    const now = nowISO();
    const { data, error } = await db
      .from("tasks")
      .insert({
        user_id: userId,
        title: input.title.trim(),
        description: input.description ?? null,
        category: input.category,
        course_id: input.courseId ?? null,
        due_at: input.dueAt ?? null,
        due_all_day: input.dueAllDay ?? false,
        start_at: input.startAt ?? null,
        priority: input.priority ?? "normal",
        status: input.status ?? "todo",
        estimate_min: input.estimateMin ?? 30,
        source: input.source ?? "manual",
        source_ref: input.sourceRef ?? null,
        external_url: input.externalUrl ?? null,
        notes: input.notes ?? null,
        subtasks: (input.subtasks ?? []).map((s, i) => ({
          id: `${now}-${i}`,
          title: s.title,
          done: s.done ?? false,
          position: i,
        })),
        position: 0,
      })
      .select()
      .single();
    return taskFromRow(check(data, error, "create task") as Row);
  }

  async updateTask(userId: UUID, id: UUID, patch: Partial<Task>): Promise<Task> {
    const db = this.db();
    const { data, error } = await db
      .from("tasks")
      .update(taskToRow(patch))
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    return taskFromRow(check(data, error, "update task") as Row);
  }

  async deleteTask(userId: UUID, id: UUID): Promise<void> {
    const db = this.db();
    const { error } = await db
      .from("tasks")
      .update({ deleted_at: nowISO() })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(`delete task: ${error.message}`);
  }

  async createNote(userId: UUID, input: NoteInput): Promise<Note> {
    const db = this.db();
    const { data, error } = await db
      .from("notes")
      .insert({
        user_id: userId,
        course_id: input.courseId ?? null,
        kind: input.kind ?? "thought",
        body: input.body.trim(),
      })
      .select()
      .single();
    return noteFromRow(check(data, error, "create note") as Row);
  }

  async updateNote(userId: UUID, id: UUID, patch: Partial<Note>): Promise<Note> {
    const db = this.db();
    const row: Row = {};
    if (patch.body !== undefined) row["body"] = patch.body;
    if (patch.kind !== undefined) row["kind"] = patch.kind;
    if (patch.pinned !== undefined) row["pinned"] = patch.pinned;
    if (patch.courseId !== undefined) row["course_id"] = patch.courseId ?? null;
    if (patch.taskId !== undefined) row["task_id"] = patch.taskId ?? null;
    const { data, error } = await db
      .from("notes")
      .update(row)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    return noteFromRow(check(data, error, "update note") as Row);
  }

  async deleteNote(userId: UUID, id: UUID): Promise<void> {
    const db = this.db();
    const { error } = await db.from("notes").delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error(`delete note: ${error.message}`);
  }

  async upsertCourses(userId: UUID, items: Course[]): Promise<ImportResult> {
    if (items.length === 0) return { imported: 0, updated: 0, skipped: 0 };
    const db = this.db();
    const { error } = await db.from("courses").upsert(
      items.map((c) => ({
        id: c.id,
        user_id: userId,
        name: c.name,
        teacher: c.teacher ?? null,
        room: c.room ?? null,
        period: c.period ?? null,
        color: c.color,
        grade: c.grade ?? null,
        source: c.source,
        source_ref: c.sourceRef ?? null,
        external_url: c.externalUrl ?? null,
        active: c.active,
      })),
      { onConflict: "user_id,source,source_ref" },
    );
    if (error) throw new Error(`upsert courses: ${error.message}`);
    return { imported: items.length, updated: 0, skipped: 0 };
  }

  async upsertAssignments(userId: UUID, items: Assignment[]): Promise<ImportResult> {
    if (items.length === 0) return { imported: 0, updated: 0, skipped: 0 };
    const db = this.db();
    const { error } = await db.from("assignments").upsert(
      items.map((a) => ({
        id: a.id,
        user_id: userId,
        course_id: a.courseId ?? null,
        title: a.title,
        description: a.description ?? null,
        due_at: a.dueAt ?? null,
        due_all_day: a.dueAllDay,
        state: a.state,
        estimate_min: a.estimateMin,
        points: a.points ?? null,
        grade: a.grade ?? null,
        source: a.source,
        source_ref: a.sourceRef ?? null,
        external_url: a.externalUrl ?? null,
      })),
      { onConflict: "user_id,source,source_ref" },
    );
    if (error) throw new Error(`upsert assignments: ${error.message}`);
    return { imported: items.length, updated: 0, skipped: 0 };
  }

  async replaceEvents(
    userId: UUID,
    calendarIds: string[],
    items: CalendarEvent[],
  ): Promise<ImportResult> {
    const db = this.db();
    if (calendarIds.length > 0) {
      const { error } = await db
        .from("events")
        .delete()
        .eq("user_id", userId)
        .in("calendar_id", calendarIds);
      if (error) throw new Error(`clear events: ${error.message}`);
    }
    if (items.length === 0) return { imported: 0, updated: 0, skipped: 0 };
    const { error } = await db.from("events").upsert(
      items.map((e) => ({
        id: e.id,
        user_id: userId,
        title: e.title,
        description: e.description ?? null,
        location: e.location ?? null,
        start_at: e.startAt,
        end_at: e.endAt ?? null,
        all_day: e.allDay,
        kind: e.kind,
        source: e.source,
        calendar_id: e.calendarId,
        source_ref: e.sourceRef ?? null,
        external_url: e.externalUrl ?? null,
      })),
      { onConflict: "id" },
    );
    if (error) throw new Error(`upsert events: ${error.message}`);
    return { imported: items.length, updated: 0, skipped: 0 };
  }

  async upsertIntegration(userId: UUID, record: IntegrationRecord): Promise<IntegrationRecord> {
    const db = this.db();
    const { data, error } = await db
      .from("integrations")
      .upsert(
        {
          id: record.id,
          user_id: userId,
          status: record.status,
          last_sync_at: record.lastSyncAt ?? null,
          last_error: record.lastError ?? null,
          meta: record.meta,
        },
        { onConflict: "user_id,id" },
      )
      .select()
      .single();
    return integrationFromRow(check(data, error, "upsert integration") as Row);
  }

  async recordSyncRun(userId: UUID, run: SyncRun): Promise<void> {
    const db = this.db();
    const { error } = await db.from("sync_runs").insert({
      id: run.id,
      user_id: userId,
      provider: run.provider,
      started_at: run.startedAt,
      finished_at: run.finishedAt ?? null,
      ok: run.ok,
      imported: run.imported,
      updated: run.updated,
      skipped: run.skipped,
      message: run.message ?? null,
    });
    if (error) throw new Error(`record sync run: ${error.message}`);
  }

  async savePreferences(userId: UUID, prefs: UserPreferences): Promise<UserPreferences> {
    const db = this.db();
    const { data, error } = await db
      .from("user_preferences")
      .upsert(
        {
          user_id: userId,
          theme: prefs.theme,
          workday_start: prefs.workdayStart,
          workday_end: prefs.workdayEnd,
          reduced_motion: prefs.reducedMotion,
          updated_at: nowISO(),
        },
        { onConflict: "user_id" },
      )
      .select()
      .single();
    return preferencesFromRow(check(data, error, "save preferences") as Row, userId);
  }

  async exportWorkspace(userId: UUID): Promise<Workspace> {
    return this.loadWorkspace(userId);
  }

  async deleteAllData(userId: UUID): Promise<void> {
    const db = this.db();
    // Notes reference courses and tasks, so they go first; the rest are
    // independent of each other.
    const tables = [
      "notes",
      "tasks",
      "assignments",
      "events",
      "courses",
      "integrations",
      "sync_runs",
      "user_preferences",
    ];
    for (const table of tables) {
      const { error } = await db.from(table).delete().eq("user_id", userId);
      if (error) throw new Error(`delete ${table}: ${error.message}`);
    }
  }
}

// ---- row mappers ---------------------------------------------------------

function str(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function opt(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(row: Row, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === "number" ? value : fallback;
}

function optNum(row: Row, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

function bool(row: Row, key: string, fallback = false): boolean {
  const value = row[key];
  return typeof value === "boolean" ? value : fallback;
}

function arr<T>(row: Row, key: string): T[] {
  const value = row[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function taskFromRow(row: Row): Task {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    title: str(row, "title"),
    description: opt(row, "description"),
    category: (opt(row, "category") ?? "personal") as Task["category"],
    courseId: opt(row, "course_id"),
    dueAt: opt(row, "due_at"),
    dueAllDay: bool(row, "due_all_day"),
    startAt: opt(row, "start_at"),
    priority: (opt(row, "priority") ?? "normal") as Task["priority"],
    status: (opt(row, "status") ?? "todo") as Task["status"],
    estimateMin: num(row, "estimate_min", 30),
    actualMin: optNum(row, "actual_min"),
    source: (opt(row, "source") ?? "manual") as Task["source"],
    sourceRef: opt(row, "source_ref"),
    externalUrl: opt(row, "external_url"),
    notes: opt(row, "notes"),
    subtasks: arr<Task["subtasks"][number]>(row, "subtasks"),
    position: num(row, "position"),
    completedAt: opt(row, "completed_at"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
    deletedAt: opt(row, "deleted_at"),
  };
}

function taskToRow(patch: Partial<Task>): Row {
  const row: Row = { updated_at: nowISO() };
  if (patch.title !== undefined) row["title"] = patch.title;
  if (patch.description !== undefined) row["description"] = patch.description ?? null;
  if (patch.category !== undefined) row["category"] = patch.category;
  if (patch.courseId !== undefined) row["course_id"] = patch.courseId ?? null;
  if (patch.dueAt !== undefined) row["due_at"] = patch.dueAt ?? null;
  if (patch.dueAllDay !== undefined) row["due_all_day"] = patch.dueAllDay;
  if (patch.startAt !== undefined) row["start_at"] = patch.startAt ?? null;
  if (patch.priority !== undefined) row["priority"] = patch.priority;
  if (patch.status !== undefined) row["status"] = patch.status;
  if (patch.estimateMin !== undefined) row["estimate_min"] = patch.estimateMin;
  if (patch.actualMin !== undefined) row["actual_min"] = patch.actualMin ?? null;
  if (patch.notes !== undefined) row["notes"] = patch.notes ?? null;
  if (patch.externalUrl !== undefined) row["external_url"] = patch.externalUrl ?? null;
  if (patch.subtasks !== undefined) row["subtasks"] = patch.subtasks;
  if (patch.position !== undefined) row["position"] = patch.position;
  if (patch.completedAt !== undefined) row["completed_at"] = patch.completedAt ?? null;
  return row;
}

function courseFromRow(row: Row): Course {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    name: str(row, "name"),
    teacher: opt(row, "teacher"),
    room: opt(row, "room"),
    period: optNum(row, "period"),
    color: opt(row, "color") ?? "var(--chart-1)",
    grade: opt(row, "grade"),
    source: (opt(row, "source") ?? "manual") as Course["source"],
    sourceRef: opt(row, "source_ref"),
    externalUrl: opt(row, "external_url"),
    active: bool(row, "active", true),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function assignmentFromRow(row: Row): Assignment {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    courseId: opt(row, "course_id"),
    title: str(row, "title"),
    description: opt(row, "description"),
    dueAt: opt(row, "due_at"),
    dueAllDay: bool(row, "due_all_day"),
    state: (opt(row, "state") ?? "assigned") as Assignment["state"],
    estimateMin: num(row, "estimate_min", 30),
    points: optNum(row, "points"),
    grade: opt(row, "grade"),
    source: (opt(row, "source") ?? "manual") as Assignment["source"],
    sourceRef: opt(row, "source_ref"),
    externalUrl: opt(row, "external_url"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function eventFromRow(row: Row): CalendarEvent {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    title: str(row, "title"),
    description: opt(row, "description"),
    location: opt(row, "location"),
    startAt: str(row, "start_at"),
    endAt: opt(row, "end_at"),
    allDay: bool(row, "all_day"),
    kind: (opt(row, "kind") ?? "personal") as CalendarEvent["kind"],
    source: (opt(row, "source") ?? "manual") as CalendarEvent["source"],
    calendarId: str(row, "calendar_id"),
    sourceRef: opt(row, "source_ref"),
    externalUrl: opt(row, "external_url"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function noteFromRow(row: Row): Note {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    courseId: opt(row, "course_id"),
    kind: (opt(row, "kind") ?? "thought") as Note["kind"],
    body: str(row, "body"),
    taskId: opt(row, "task_id"),
    pinned: bool(row, "pinned"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function integrationFromRow(row: Row): IntegrationRecord {
  const meta = row["meta"];
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    status: (opt(row, "status") ?? "disconnected") as IntegrationRecord["status"],
    lastSyncAt: opt(row, "last_sync_at"),
    lastError: opt(row, "last_error"),
    meta: meta && typeof meta === "object" ? (meta as Record<string, string>) : {},
    updatedAt: str(row, "updated_at"),
  };
}

function syncRunFromRow(row: Row): SyncRun {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    provider: str(row, "provider"),
    startedAt: str(row, "started_at"),
    finishedAt: opt(row, "finished_at"),
    ok: bool(row, "ok"),
    imported: num(row, "imported"),
    updated: num(row, "updated"),
    skipped: num(row, "skipped"),
    message: opt(row, "message"),
  };
}

function preferencesFromRow(row: Row, userId: UUID): UserPreferences {
  const fallback = defaultPreferences(userId);
  return {
    userId,
    theme: (opt(row, "theme") ?? fallback.theme) as UserPreferences["theme"],
    workdayStart: opt(row, "workday_start") ?? fallback.workdayStart,
    workdayEnd: opt(row, "workday_end") ?? fallback.workdayEnd,
    reducedMotion: bool(row, "reduced_motion", fallback.reducedMotion),
    updatedAt: str(row, "updated_at") || fallback.updatedAt,
  };
}

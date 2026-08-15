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
  AppNotification,
  Assignment,
  CalendarEvent,
  Course,
  FocusSession,
  IntegrationRecord,
  Opportunity,
  Profile,
  Project,
  SyncRun,
  Task,
  UserPreferences,
  UUID,
  Workspace,
} from "@/lib/core/types";

import { defaultPreferences, seedCourses } from "./seed";
import type { ImportResult, OpportunityInput, Repository, TaskInput } from "./types";

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
    const [
      tasks,
      courses,
      assignments,
      events,
      projects,
      opportunities,
      focusSessions,
      notifications,
      integrations,
      syncRuns,
      preferences,
    ] = await Promise.all([
      db.from("tasks").select("*").eq("user_id", userId).is("deleted_at", null),
      db.from("courses").select("*").eq("user_id", userId),
      db.from("assignments").select("*").eq("user_id", userId),
      db.from("events").select("*").eq("user_id", userId),
      db.from("projects").select("*").eq("user_id", userId),
      db.from("opportunities").select("*").eq("user_id", userId),
      db.from("focus_sessions").select("*").eq("user_id", userId),
      db
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200),
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
      projects: check(projects.data, projects.error, "load projects").map(projectFromRow),
      opportunities: check(opportunities.data, opportunities.error, "load opportunities").map(
        opportunityFromRow,
      ),
      focusSessions: check(focusSessions.data, focusSessions.error, "load focus sessions").map(
        focusFromRow,
      ),
      notifications: check(notifications.data, notifications.error, "load notifications").map(
        notificationFromRow,
      ),
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
        project_id: input.projectId ?? null,
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

  async reorderTasks(userId: UUID, orderedIds: UUID[]): Promise<void> {
    const db = this.db();
    await Promise.all(
      orderedIds.map((id, position) =>
        db.from("tasks").update({ position }).eq("id", id).eq("user_id", userId),
      ),
    );
  }

  async saveFocusSession(userId: UUID, session: FocusSession): Promise<FocusSession> {
    const db = this.db();
    const { data, error } = await db
      .from("focus_sessions")
      .upsert({
        id: session.id,
        user_id: userId,
        task_id: session.taskId ?? null,
        task_title: session.taskTitle,
        category: session.category,
        planned_min: session.plannedMin,
        elapsed_sec: session.elapsedSec,
        status: session.status,
        started_at: session.startedAt,
        resumed_at: session.resumedAt ?? null,
        ended_at: session.endedAt ?? null,
        reflection: session.reflection ?? null,
      })
      .select()
      .single();
    return focusFromRow(check(data, error, "save focus session") as Row);
  }

  async createOpportunity(userId: UUID, input: OpportunityInput): Promise<Opportunity> {
    const db = this.db();
    const { data, error } = await db
      .from("opportunities")
      .insert({
        user_id: userId,
        org: input.org.trim(),
        title: input.title.trim(),
        type: input.type,
        stage: input.stage ?? "discovered",
        contact: input.contact ?? null,
        deadline_at: input.deadlineAt ?? null,
        next_action: input.nextAction ?? null,
        notes: input.notes ?? null,
        related_email: input.relatedEmail ?? null,
        related_url: input.relatedUrl ?? null,
      })
      .select()
      .single();
    return opportunityFromRow(check(data, error, "create opportunity") as Row);
  }

  async updateOpportunity(
    userId: UUID,
    id: UUID,
    patch: Partial<Opportunity>,
  ): Promise<Opportunity> {
    const db = this.db();
    const { data, error } = await db
      .from("opportunities")
      .update(opportunityToRow(patch))
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    return opportunityFromRow(check(data, error, "update opportunity") as Row);
  }

  async deleteOpportunity(userId: UUID, id: UUID): Promise<void> {
    const db = this.db();
    const { error } = await db.from("opportunities").delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error(`delete opportunity: ${error.message}`);
  }

  async upsertNotifications(userId: UUID, items: AppNotification[]): Promise<ImportResult> {
    if (items.length === 0) return { imported: 0, updated: 0, skipped: 0 };
    const db = this.db();
    const { error, count } = await db.from("notifications").upsert(
      items.map((n) => ({
        id: n.id,
        user_id: userId,
        category: n.category,
        title: n.title,
        detail: n.detail ?? null,
        source: n.source,
        href: n.href ?? null,
        external_url: n.externalUrl ?? null,
        read: n.read,
        created_at: n.createdAt,
        dedupe_key: n.dedupeKey,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true, count: "exact" },
    );
    if (error) throw new Error(`upsert notifications: ${error.message}`);
    const imported = count ?? 0;
    return { imported, updated: 0, skipped: items.length - imported };
  }

  async updateNotification(
    userId: UUID,
    id: UUID,
    patch: Partial<AppNotification>,
  ): Promise<AppNotification> {
    const db = this.db();
    const { data, error } = await db
      .from("notifications")
      .update({ read: patch.read })
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    return notificationFromRow(check(data, error, "update notification") as Row);
  }

  async markAllNotificationsRead(userId: UUID): Promise<void> {
    const db = this.db();
    const { error } = await db
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (error) throw new Error(`mark all read: ${error.message}`);
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

  async upsertProjects(userId: UUID, items: Project[]): Promise<ImportResult> {
    if (items.length === 0) return { imported: 0, updated: 0, skipped: 0 };
    const db = this.db();
    const { error } = await db.from("projects").upsert(
      items.map((p) => ({
        id: p.id,
        user_id: userId,
        name: p.name,
        kind: p.kind,
        objective: p.objective,
        progress: p.progress,
        health: p.health,
        blockers: p.blockers,
        deadline_at: p.deadlineAt ?? null,
        deadline_label: p.deadlineLabel ?? null,
        contact: p.contact ?? null,
        github_repo: p.githubRepo ?? null,
        vercel_project: p.vercelProject ?? null,
        links: p.links,
        metrics: p.metrics,
        documents: p.documents,
        activity: p.activity,
      })),
      { onConflict: "user_id,id" },
    );
    if (error) throw new Error(`upsert projects: ${error.message}`);
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
          focus_goal_hours: prefs.focusGoalHours,
          weekly_task_goal: prefs.weeklyTaskGoal,
          workday_start: prefs.workdayStart,
          workday_end: prefs.workdayEnd,
          muted_notification_categories: prefs.mutedNotificationCategories,
          browser_notifications: prefs.browserNotifications,
          compass_tone: prefs.compassTone,
          compass_auto_run_read_tools: prefs.compassAutoRunReadTools,
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

  async resetToDemoData(): Promise<Workspace> {
    throw new Error(
      "Demo data reset is only available in demo mode. Use Settings → Data to delete your data instead.",
    );
  }

  async deleteAllData(userId: UUID): Promise<void> {
    const db = this.db();
    const tables = [
      "tasks",
      "assignments",
      "events",
      "courses",
      "projects",
      "opportunities",
      "focus_sessions",
      "notifications",
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
    projectId: opt(row, "project_id"),
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
  if (patch.projectId !== undefined) row["project_id"] = patch.projectId ?? null;
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

function projectFromRow(row: Row): Project {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    name: str(row, "name"),
    kind: str(row, "kind"),
    objective: str(row, "objective"),
    progress: num(row, "progress"),
    health: (opt(row, "health") ?? "on_track") as Project["health"],
    blockers: arr<string>(row, "blockers"),
    deadlineAt: opt(row, "deadline_at"),
    deadlineLabel: opt(row, "deadline_label"),
    contact: opt(row, "contact"),
    githubRepo: opt(row, "github_repo"),
    vercelProject: opt(row, "vercel_project"),
    links: arr<Project["links"][number]>(row, "links"),
    metrics: arr<Project["metrics"][number]>(row, "metrics"),
    documents: arr<Project["documents"][number]>(row, "documents"),
    activity: arr<Project["activity"][number]>(row, "activity"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function opportunityFromRow(row: Row): Opportunity {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    org: str(row, "org"),
    title: str(row, "title"),
    type: (opt(row, "type") ?? "application") as Opportunity["type"],
    stage: (opt(row, "stage") ?? "discovered") as Opportunity["stage"],
    contact: opt(row, "contact"),
    deadlineAt: opt(row, "deadline_at"),
    lastInteractionAt: opt(row, "last_interaction_at"),
    lastInteractionNote: opt(row, "last_interaction_note"),
    nextAction: opt(row, "next_action"),
    notes: opt(row, "notes"),
    relatedEmail: opt(row, "related_email"),
    relatedUrl: opt(row, "related_url"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function opportunityToRow(patch: Partial<Opportunity>): Row {
  const row: Row = { updated_at: nowISO() };
  if (patch.org !== undefined) row["org"] = patch.org;
  if (patch.title !== undefined) row["title"] = patch.title;
  if (patch.type !== undefined) row["type"] = patch.type;
  if (patch.stage !== undefined) row["stage"] = patch.stage;
  if (patch.contact !== undefined) row["contact"] = patch.contact ?? null;
  if (patch.deadlineAt !== undefined) row["deadline_at"] = patch.deadlineAt ?? null;
  if (patch.lastInteractionAt !== undefined)
    row["last_interaction_at"] = patch.lastInteractionAt ?? null;
  if (patch.lastInteractionNote !== undefined)
    row["last_interaction_note"] = patch.lastInteractionNote ?? null;
  if (patch.nextAction !== undefined) row["next_action"] = patch.nextAction ?? null;
  if (patch.notes !== undefined) row["notes"] = patch.notes ?? null;
  if (patch.relatedEmail !== undefined) row["related_email"] = patch.relatedEmail ?? null;
  if (patch.relatedUrl !== undefined) row["related_url"] = patch.relatedUrl ?? null;
  return row;
}

function focusFromRow(row: Row): FocusSession {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    taskId: opt(row, "task_id"),
    taskTitle: str(row, "task_title"),
    category: (opt(row, "category") ?? "personal") as FocusSession["category"],
    plannedMin: num(row, "planned_min"),
    elapsedSec: num(row, "elapsed_sec"),
    status: (opt(row, "status") ?? "completed") as FocusSession["status"],
    startedAt: str(row, "started_at"),
    resumedAt: opt(row, "resumed_at"),
    endedAt: opt(row, "ended_at"),
    reflection: opt(row, "reflection"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function notificationFromRow(row: Row): AppNotification {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    category: (opt(row, "category") ?? "system") as AppNotification["category"],
    title: str(row, "title"),
    detail: opt(row, "detail"),
    source: (opt(row, "source") ?? "manual") as AppNotification["source"],
    href: opt(row, "href"),
    externalUrl: opt(row, "external_url"),
    read: bool(row, "read"),
    createdAt: str(row, "created_at"),
    dedupeKey: str(row, "dedupe_key"),
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
    focusGoalHours: num(row, "focus_goal_hours", fallback.focusGoalHours),
    weeklyTaskGoal: num(row, "weekly_task_goal", fallback.weeklyTaskGoal),
    workdayStart: opt(row, "workday_start") ?? fallback.workdayStart,
    workdayEnd: opt(row, "workday_end") ?? fallback.workdayEnd,
    mutedNotificationCategories: arr<UserPreferences["mutedNotificationCategories"][number]>(
      row,
      "muted_notification_categories",
    ),
    browserNotifications: bool(row, "browser_notifications", fallback.browserNotifications),
    compassTone: (opt(row, "compass_tone") ??
      fallback.compassTone) as UserPreferences["compassTone"],
    compassAutoRunReadTools: bool(
      row,
      "compass_auto_run_read_tools",
      fallback.compassAutoRunReadTools,
    ),
    reducedMotion: bool(row, "reduced_motion", fallback.reducedMotion),
    updatedAt: str(row, "updated_at") || fallback.updatedAt,
  };
}

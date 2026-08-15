/**
 * Browser-backed repository.
 *
 * Data lives in `localStorage` under a versioned key, scoped per user id, so a
 * demo session and a signed-in session never see each other's records. The
 * async signatures match `SupabaseRepository` exactly.
 */

import { newId, stableId } from "@/lib/core/ids";
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

import { defaultPreferences, emptyWorkspace, seedWorkspace } from "./seed";
import type { ImportResult, OpportunityInput, Repository, TaskInput } from "./types";

const SCHEMA_VERSION = 1;
const KEY_PREFIX = "aaditos:v1:workspace:";

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

interface Persisted {
  version: number;
  workspace: Workspace;
}

function hasStorage(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "__aaditos_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export class LocalRepository implements Repository {
  readonly kind = "local" as const;

  private cache = new Map<UUID, Workspace>();

  constructor(
    private readonly profileFor: (userId: UUID) => Profile,
    private readonly seedOnFirstRun: boolean,
  ) {}

  private key(userId: UUID): string {
    return `${KEY_PREFIX}${userId}`;
  }

  private read(userId: UUID): Workspace {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const profile = this.profileFor(userId);
    let workspace: Workspace | null = null;

    if (hasStorage()) {
      try {
        const raw = window.localStorage.getItem(this.key(userId));
        if (raw) {
          const parsed = JSON.parse(raw) as Persisted;
          if (parsed && parsed.version === SCHEMA_VERSION && parsed.workspace) {
            workspace = { ...parsed.workspace, profile };
          }
        }
      } catch {
        // Corrupt payload — fall through to a fresh workspace rather than crash.
        workspace = null;
      }
    }

    if (!workspace) {
      workspace = this.seedOnFirstRun
        ? seedWorkspace(userId, profile)
        : emptyWorkspace(userId, profile);
      this.cache.set(userId, workspace);
      this.write(userId);
      return workspace;
    }

    workspace.preferences = { ...defaultPreferences(userId), ...workspace.preferences, userId };
    this.cache.set(userId, workspace);
    return workspace;
  }

  private write(userId: UUID): void {
    const workspace = this.cache.get(userId);
    if (!workspace || !hasStorage()) return;
    try {
      const payload: Persisted = { version: SCHEMA_VERSION, workspace };
      window.localStorage.setItem(this.key(userId), JSON.stringify(payload));
    } catch (error) {
      // Quota exceeded: drop the coldest history so the core record set survives.
      workspace.syncRuns = workspace.syncRuns.slice(-10);
      workspace.focusSessions = workspace.focusSessions.slice(-120);
      workspace.notifications = workspace.notifications.slice(-80);
      try {
        window.localStorage.setItem(
          this.key(userId),
          JSON.stringify({ version: SCHEMA_VERSION, workspace }),
        );
      } catch {
        throw new StorageUnavailableError(
          error instanceof Error ? error.message : "Browser storage is full",
        );
      }
    }
  }

  async loadWorkspace(userId: UUID): Promise<Workspace> {
    return structuredCopy(this.read(userId));
  }

  async createTask(userId: UUID, input: TaskInput): Promise<Task> {
    const ws = this.read(userId);
    const now = nowISO();
    const task: Task = {
      id: newId(),
      userId,
      title: input.title.trim(),
      description: input.description,
      category: input.category,
      courseId: input.courseId,
      projectId: input.projectId,
      dueAt: input.dueAt,
      dueAllDay: input.dueAllDay ?? false,
      startAt: input.startAt,
      priority: input.priority ?? "normal",
      status: input.status ?? "todo",
      estimateMin: input.estimateMin ?? 30,
      source: input.source ?? "manual",
      sourceRef: input.sourceRef,
      externalUrl: input.externalUrl,
      notes: input.notes,
      subtasks: (input.subtasks ?? []).map((s, i) => ({
        id: newId(),
        title: s.title,
        done: s.done ?? false,
        position: i,
      })),
      position: ws.tasks.length ? Math.min(...ws.tasks.map((t) => t.position)) - 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    ws.tasks = [task, ...ws.tasks];
    this.write(userId);
    return structuredCopy(task);
  }

  async updateTask(userId: UUID, id: UUID, patch: Partial<Task>): Promise<Task> {
    const ws = this.read(userId);
    const index = ws.tasks.findIndex((t) => t.id === id);
    if (index < 0) throw new Error(`Task not found: ${id}`);
    const current = ws.tasks[index]!;
    const next: Task = { ...current, ...patch, id: current.id, userId, updatedAt: nowISO() };
    if (patch.status === "done" && current.status !== "done") next.completedAt = nowISO();
    if (patch.status && patch.status !== "done") next.completedAt = undefined;
    ws.tasks[index] = next;
    this.write(userId);
    return structuredCopy(next);
  }

  async deleteTask(userId: UUID, id: UUID): Promise<void> {
    const ws = this.read(userId);
    ws.tasks = ws.tasks.filter((t) => t.id !== id);
    this.write(userId);
  }

  async reorderTasks(userId: UUID, orderedIds: UUID[]): Promise<void> {
    const ws = this.read(userId);
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    ws.tasks = ws.tasks.map((t) =>
      rank.has(t.id) ? { ...t, position: rank.get(t.id)!, updatedAt: nowISO() } : t,
    );
    this.write(userId);
  }

  async saveFocusSession(userId: UUID, session: FocusSession): Promise<FocusSession> {
    const ws = this.read(userId);
    const index = ws.focusSessions.findIndex((s) => s.id === session.id);
    const next = { ...session, userId, updatedAt: nowISO() };
    if (index >= 0) ws.focusSessions[index] = next;
    else ws.focusSessions = [next, ...ws.focusSessions];
    this.write(userId);
    return structuredCopy(next);
  }

  async createOpportunity(userId: UUID, input: OpportunityInput): Promise<Opportunity> {
    const ws = this.read(userId);
    const now = nowISO();
    const record: Opportunity = {
      id: newId(),
      userId,
      org: input.org.trim(),
      title: input.title.trim(),
      type: input.type,
      stage: input.stage ?? "discovered",
      contact: input.contact,
      deadlineAt: input.deadlineAt,
      nextAction: input.nextAction,
      notes: input.notes,
      relatedEmail: input.relatedEmail,
      relatedUrl: input.relatedUrl,
      createdAt: now,
      updatedAt: now,
    };
    ws.opportunities = [record, ...ws.opportunities];
    this.write(userId);
    return structuredCopy(record);
  }

  async updateOpportunity(
    userId: UUID,
    id: UUID,
    patch: Partial<Opportunity>,
  ): Promise<Opportunity> {
    const ws = this.read(userId);
    const index = ws.opportunities.findIndex((o) => o.id === id);
    if (index < 0) throw new Error(`Opportunity not found: ${id}`);
    const next = { ...ws.opportunities[index]!, ...patch, id, userId, updatedAt: nowISO() };
    ws.opportunities[index] = next;
    this.write(userId);
    return structuredCopy(next);
  }

  async deleteOpportunity(userId: UUID, id: UUID): Promise<void> {
    const ws = this.read(userId);
    ws.opportunities = ws.opportunities.filter((o) => o.id !== id);
    this.write(userId);
  }

  async upsertNotifications(userId: UUID, items: AppNotification[]): Promise<ImportResult> {
    const ws = this.read(userId);
    const byKey = new Map(ws.notifications.map((n) => [n.dedupeKey, n]));
    let imported = 0;
    let skipped = 0;
    for (const item of items) {
      if (byKey.has(item.dedupeKey)) {
        skipped += 1;
        continue;
      }
      byKey.set(item.dedupeKey, { ...item, userId });
      imported += 1;
    }
    ws.notifications = Array.from(byKey.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    this.write(userId);
    return { imported, updated: 0, skipped };
  }

  async updateNotification(
    userId: UUID,
    id: UUID,
    patch: Partial<AppNotification>,
  ): Promise<AppNotification> {
    const ws = this.read(userId);
    const index = ws.notifications.findIndex((n) => n.id === id);
    if (index < 0) throw new Error(`Notification not found: ${id}`);
    const next = { ...ws.notifications[index]!, ...patch, id, userId };
    ws.notifications[index] = next;
    this.write(userId);
    return structuredCopy(next);
  }

  async markAllNotificationsRead(userId: UUID): Promise<void> {
    const ws = this.read(userId);
    ws.notifications = ws.notifications.map((n) => ({ ...n, read: true }));
    this.write(userId);
  }

  async upsertCourses(userId: UUID, items: Course[]): Promise<ImportResult> {
    const ws = this.read(userId);
    const result = upsertBy(ws.courses, items, (c) => c.sourceRef ?? c.id);
    ws.courses = result.list;
    this.write(userId);
    return result.stats;
  }

  async upsertAssignments(userId: UUID, items: Assignment[]): Promise<ImportResult> {
    const ws = this.read(userId);
    const result = upsertBy(ws.assignments, items, (a) => a.sourceRef ?? a.id);
    ws.assignments = result.list;
    this.write(userId);
    return result.stats;
  }

  async replaceEvents(
    userId: UUID,
    calendarIds: string[],
    items: CalendarEvent[],
  ): Promise<ImportResult> {
    const ws = this.read(userId);
    const target = new Set(calendarIds);
    const previous = ws.events.filter((e) => target.has(e.calendarId));
    const previousIds = new Set(previous.map((e) => e.id));
    const retained = ws.events.filter((e) => !target.has(e.calendarId));
    ws.events = [...retained, ...items.map((e) => ({ ...e, userId }))].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
    this.write(userId);
    const imported = items.filter((e) => !previousIds.has(e.id)).length;
    return { imported, updated: items.length - imported, skipped: 0 };
  }

  async upsertProjects(userId: UUID, items: Project[]): Promise<ImportResult> {
    const ws = this.read(userId);
    const result = upsertBy(ws.projects, items, (p) => p.id);
    ws.projects = result.list;
    this.write(userId);
    return result.stats;
  }

  async upsertIntegration(userId: UUID, record: IntegrationRecord): Promise<IntegrationRecord> {
    const ws = this.read(userId);
    const index = ws.integrations.findIndex((i) => i.id === record.id);
    const next = { ...record, userId, updatedAt: nowISO() };
    if (index >= 0) ws.integrations[index] = next;
    else ws.integrations = [...ws.integrations, next];
    this.write(userId);
    return structuredCopy(next);
  }

  async recordSyncRun(userId: UUID, run: SyncRun): Promise<void> {
    const ws = this.read(userId);
    ws.syncRuns = [{ ...run, userId }, ...ws.syncRuns].slice(0, 50);
    this.write(userId);
  }

  async savePreferences(userId: UUID, prefs: UserPreferences): Promise<UserPreferences> {
    const ws = this.read(userId);
    ws.preferences = { ...prefs, userId, updatedAt: nowISO() };
    this.write(userId);
    return structuredCopy(ws.preferences);
  }

  async exportWorkspace(userId: UUID): Promise<Workspace> {
    return structuredCopy(this.read(userId));
  }

  async resetToDemoData(userId: UUID): Promise<Workspace> {
    const workspace = seedWorkspace(userId, this.profileFor(userId));
    this.cache.set(userId, workspace);
    this.write(userId);
    return structuredCopy(workspace);
  }

  async deleteAllData(userId: UUID): Promise<void> {
    this.cache.delete(userId);
    if (hasStorage()) window.localStorage.removeItem(this.key(userId));
    const fresh = emptyWorkspace(userId, this.profileFor(userId));
    this.cache.set(userId, fresh);
    this.write(userId);
  }
}

function upsertBy<T extends { id: string; updatedAt: string }>(
  existing: T[],
  incoming: T[],
  keyOf: (item: T) => string,
): { list: T[]; stats: ImportResult } {
  const map = new Map(existing.map((item) => [keyOf(item), item]));
  let imported = 0;
  let updated = 0;
  for (const item of incoming) {
    const key = keyOf(item);
    if (map.has(key)) {
      map.set(key, { ...map.get(key)!, ...item, updatedAt: nowISO() });
      updated += 1;
    } else {
      map.set(key, item);
      imported += 1;
    }
  }
  return { list: Array.from(map.values()), stats: { imported, updated, skipped: 0 } };
}

function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function demoProfile(userId: UUID, overrides: Partial<Profile> = {}): Profile {
  return {
    id: userId,
    email: "demo@aaditos.app",
    name: "Aadit Mehta",
    school: "Wilcox High School",
    grade: "Grade 9",
    city: "Santa Clara, CA",
    timezone: "America/Los_Angeles",
    ...overrides,
  };
}

export function localUserIdFor(email: string): UUID {
  return stableId(`aaditos:user:${email.toLowerCase()}`);
}

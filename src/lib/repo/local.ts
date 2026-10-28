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
  Assignment,
  Attachment,
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

import { clearBlobsWithPrefix, deleteBlob, getBlob, putBlob } from "./blobs";
import { defaultPreferences, emptyWorkspace } from "./seed";
import type { AttachmentInput, ImportResult, NoteInput, Repository, TaskInput } from "./types";

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

  constructor(private readonly profileFor: (userId: UUID) => Profile) {}

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
            // Records written before attachments existed have no such field.
            workspace.tasks = workspace.tasks.map((t) => ({
              ...t,
              attachments: t.attachments ?? [],
            }));
            workspace.notes = workspace.notes.map((n) => ({
              ...n,
              attachments: n.attachments ?? [],
            }));
          }
        }
      } catch {
        // Corrupt payload — fall through to a fresh workspace rather than crash.
        workspace = null;
      }
    }

    if (!workspace) {
      workspace = emptyWorkspace(userId, profile);
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
      workspace.events = workspace.events.slice(-400);
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
      attachments: input.attachments ?? [],
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

  async createNote(userId: UUID, input: NoteInput): Promise<Note> {
    const ws = this.read(userId);
    const now = nowISO();
    const note: Note = {
      id: newId(),
      userId,
      courseId: input.courseId,
      kind: input.kind ?? "thought",
      body: input.body.trim(),
      taskId: undefined,
      pinned: false,
      attachments: input.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    };
    ws.notes = [note, ...ws.notes];
    this.write(userId);
    return structuredCopy(note);
  }

  async updateNote(userId: UUID, id: UUID, patch: Partial<Note>): Promise<Note> {
    const ws = this.read(userId);
    const index = ws.notes.findIndex((n) => n.id === id);
    if (index < 0) throw new Error(`Note not found: ${id}`);
    const next: Note = { ...ws.notes[index]!, ...patch, id, userId, updatedAt: nowISO() };
    ws.notes[index] = next;
    this.write(userId);
    return structuredCopy(next);
  }

  async deleteNote(userId: UUID, id: UUID): Promise<void> {
    const ws = this.read(userId);
    ws.notes = ws.notes.filter((n) => n.id !== id);
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

  async putAttachment(userId: UUID, bytes: Blob, meta: AttachmentInput): Promise<Attachment> {
    const id = newId();
    const key = `${userId}:${id}`;
    await putBlob(key, bytes);
    return {
      id,
      kind: "image",
      name: meta.name,
      mimeType: meta.mimeType,
      size: bytes.size,
      width: meta.width,
      height: meta.height,
      ref: `idb:${key}`,
      createdAt: nowISO(),
    };
  }

  private urls = new Map<string, string>();

  async attachmentUrl(_userId: UUID, attachment: Attachment): Promise<string> {
    const cached = this.urls.get(attachment.ref);
    if (cached) return cached;
    const key = attachment.ref.replace(/^idb:/, "");
    const blob = await getBlob(key);
    if (!blob) throw new Error("That image is no longer stored on this device.");
    const url = URL.createObjectURL(blob);
    this.urls.set(attachment.ref, url);
    return url;
  }

  async deleteAttachment(_userId: UUID, attachment: Attachment): Promise<void> {
    const url = this.urls.get(attachment.ref);
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(attachment.ref);
    }
    await deleteBlob(attachment.ref.replace(/^idb:/, "")).catch(() => undefined);
  }

  async exportWorkspace(userId: UUID): Promise<Workspace> {
    return structuredCopy(this.read(userId));
  }

  async deleteAllData(userId: UUID): Promise<void> {
    this.cache.delete(userId);
    if (hasStorage()) window.localStorage.removeItem(this.key(userId));
    await clearBlobsWithPrefix(`${userId}:`).catch(() => undefined);
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

export function localUserIdFor(email: string): UUID {
  return stableId(`aaditos:user:${email.toLowerCase()}`);
}

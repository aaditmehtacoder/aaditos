import { beforeEach, describe, expect, it } from "vitest";

import { stableId } from "@/lib/core/ids";
import { LocalRepository, demoProfile } from "@/lib/repo/local";
import { DEMO_USER_ID, seedCourses } from "@/lib/repo/seed";
import type { CalendarEvent, FocusSession } from "@/lib/core/types";

const USER = DEMO_USER_ID;

function repo(seed = true) {
  return new LocalRepository(() => demoProfile(USER), seed);
}

describe("LocalRepository", () => {
  beforeEach(() => window.localStorage.clear());

  it("seeds a realistic demo workspace on first run", async () => {
    const workspace = await repo().loadWorkspace(USER);
    expect(workspace.tasks.length).toBeGreaterThan(5);
    expect(workspace.courses.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Algebra 2", "English 9 H", "Spanish 1", "Biology", "Tutorial"]),
    );
    expect(workspace.projects.map((p) => p.id)).toEqual(
      expect.arrayContaining(["venu-ai", "pick44", "origami-prep", "openrubric"]),
    );
  });

  it("starts empty when seeding is off", async () => {
    const workspace = await repo(false).loadWorkspace(USER);
    expect(workspace.tasks).toHaveLength(0);
  });

  it("persists a created task across repository instances", async () => {
    const created = await repo().createTask(USER, {
      title: "Write the recap",
      category: "work",
      estimateMin: 45,
    });
    const reloaded = await repo().loadWorkspace(USER);
    expect(reloaded.tasks.find((t) => t.id === created.id)?.title).toBe("Write the recap");
  });

  it("stamps completedAt when a task is completed and clears it on reopen", async () => {
    const r = repo();
    const created = await r.createTask(USER, { title: "Ship it", category: "work" });
    const done = await r.updateTask(USER, created.id, { status: "done" });
    expect(done.completedAt).toBeTruthy();
    const reopened = await r.updateTask(USER, created.id, { status: "todo" });
    expect(reopened.completedAt).toBeUndefined();
  });

  it("throws a clear error when updating a task that does not exist", async () => {
    await expect(repo().updateTask(USER, "missing", { title: "x" })).rejects.toThrow(/not found/i);
  });

  it("reorders tasks and keeps the order after reload", async () => {
    const r = repo(false);
    const a = await r.createTask(USER, { title: "A", category: "personal" });
    const b = await r.createTask(USER, { title: "B", category: "personal" });
    await r.reorderTasks(USER, [b.id, a.id]);
    const reloaded = await repo(false).loadWorkspace(USER);
    const ordered = [...reloaded.tasks].sort((x, y) => x.position - y.position);
    expect(ordered.map((t) => t.title)).toEqual(["B", "A"]);
  });

  it("keeps each user's data separate", async () => {
    const other = stableId("other-user");
    const r = repo(false);
    await r.createTask(USER, { title: "Mine", category: "personal" });
    const otherWorkspace = await new LocalRepository(() => demoProfile(other), false).loadWorkspace(
      other,
    );
    expect(otherWorkspace.tasks).toHaveLength(0);
  });

  it("saves and updates a focus session by id", async () => {
    const r = repo(false);
    const session: FocusSession = {
      id: "focus-1",
      userId: USER,
      taskTitle: "Deep work",
      category: "work",
      plannedMin: 25,
      elapsedSec: 600,
      status: "running",
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await r.saveFocusSession(USER, session);
    await r.saveFocusSession(USER, { ...session, status: "completed", elapsedSec: 1500 });
    const workspace = await r.loadWorkspace(USER);
    expect(workspace.focusSessions.filter((s) => s.id === "focus-1")).toHaveLength(1);
    expect(workspace.focusSessions.find((s) => s.id === "focus-1")?.elapsedSec).toBe(1500);
  });

  it("deduplicates notifications by dedupe key", async () => {
    const r = repo(false);
    const notification = {
      id: "n1",
      userId: USER,
      category: "system" as const,
      title: "Sync failed",
      source: "github" as const,
      read: false,
      createdAt: new Date().toISOString(),
      dedupeKey: "github:sync-failed:2026-08-12",
    };
    const first = await r.upsertNotifications(USER, [notification]);
    const second = await r.upsertNotifications(USER, [{ ...notification, id: "n2" }]);
    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect((await r.loadWorkspace(USER)).notifications).toHaveLength(1);
  });

  it("replaces events for a calendar without touching other calendars", async () => {
    const r = repo(false);
    const make = (id: string, calendarId: string): CalendarEvent => ({
      id,
      userId: USER,
      title: id,
      startAt: new Date().toISOString(),
      allDay: true,
      kind: "school",
      source: "wilcox",
      calendarId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await r.replaceEvents(USER, ["wilcox:school"], [make("a", "wilcox:school")]);
    await r.replaceEvents(USER, ["wilcox:athletics"], [make("b", "wilcox:athletics")]);
    await r.replaceEvents(USER, ["wilcox:school"], [make("c", "wilcox:school")]);

    const workspace = await r.loadWorkspace(USER);
    expect(workspace.events.map((e) => e.id).sort()).toEqual(["b", "c"]);
  });

  it("counts a re-import as an update rather than a new insert", async () => {
    const r = repo(false);
    const event: CalendarEvent = {
      id: "same",
      userId: USER,
      title: "Picture Day",
      startAt: new Date().toISOString(),
      allDay: true,
      kind: "school",
      source: "wilcox",
      calendarId: "wilcox:school",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect((await r.replaceEvents(USER, ["wilcox:school"], [event])).imported).toBe(1);
    expect((await r.replaceEvents(USER, ["wilcox:school"], [event])).updated).toBe(1);
  });

  it("exports and then deletes everything", async () => {
    const r = repo();
    const exported = await r.exportWorkspace(USER);
    expect(exported.tasks.length).toBeGreaterThan(0);
    await r.deleteAllData(USER);
    expect((await r.loadWorkspace(USER)).tasks).toHaveLength(0);
  });

  it("restores demo data after a reset", async () => {
    const r = repo();
    await r.deleteAllData(USER);
    const restored = await r.resetToDemoData(USER);
    expect(restored.tasks.length).toBeGreaterThan(0);
  });

  it("recovers from a corrupted storage payload instead of crashing", async () => {
    window.localStorage.setItem(`aaditos:v1:workspace:${USER}`, "{not json");
    const workspace = await repo().loadWorkspace(USER);
    expect(workspace.tasks.length).toBeGreaterThan(0);
  });

  it("persists preference changes", async () => {
    const r = repo();
    const workspace = await r.loadWorkspace(USER);
    await r.savePreferences(USER, { ...workspace.preferences, theme: "dark", focusGoalHours: 12 });
    const reloaded = await repo().loadWorkspace(USER);
    expect(reloaded.preferences.theme).toBe("dark");
    expect(reloaded.preferences.focusGoalHours).toBe(12);
  });
});

/**
 * The seeded class schedule is the same for every student at the school, so an
 * id derived from the course key alone collides across accounts on the
 * `courses_pkey` primary key. See tests/google.test.ts for why that is fatal.
 */
describe("seedCourses", () => {
  it("gives two accounts different course ids for the same schedule", () => {
    const a = seedCourses("user-a", new Date("2026-08-14T12:00:00Z"));
    const b = seedCourses("user-b", new Date("2026-08-14T12:00:00Z"));
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
    expect(a.some((c) => b.some((other) => other.id === c.id))).toBe(false);
  });

  it("is stable for one account, so re-seeding never duplicates", () => {
    const first = seedCourses("user-a", new Date("2026-08-14T12:00:00Z"));
    const second = seedCourses("user-a", new Date("2026-09-01T12:00:00Z"));
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
  });

  it("keeps sourceRef shared, since the unique constraint is per user already", () => {
    const a = seedCourses("user-a", new Date("2026-08-14T12:00:00Z"));
    const b = seedCourses("user-b", new Date("2026-08-14T12:00:00Z"));
    expect(a.map((c) => c.sourceRef)).toEqual(b.map((c) => c.sourceRef));
  });
});

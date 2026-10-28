import { beforeEach, describe, expect, it } from "vitest";

import { stableId } from "@/lib/core/ids";
import { LocalRepository } from "@/lib/repo/local";
import { seedCourses } from "@/lib/repo/seed";
import type { CalendarEvent, Profile } from "@/lib/core/types";

const USER = stableId("test-user");

function profileFor(userId: string): Profile {
  return {
    id: userId,
    email: "test@aaditos.app",
    name: "Aadit Mehta",
    school: "Wilcox High School",
    grade: "Grade 9",
    city: "Santa Clara, CA",
    timezone: "America/Los_Angeles",
  };
}

function repo() {
  return new LocalRepository(profileFor);
}

describe("LocalRepository", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts empty on first run — there is no sample data", async () => {
    const workspace = await repo().loadWorkspace(USER);
    expect(workspace.tasks).toHaveLength(0);
    expect(workspace.courses).toHaveLength(0);
    expect(workspace.notes).toHaveLength(0);
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

  it("keeps each user's data separate", async () => {
    const other = stableId("other-user");
    const r = repo();
    await r.createTask(USER, { title: "Mine", category: "personal" });
    const otherWorkspace = await new LocalRepository(profileFor).loadWorkspace(other);
    expect(otherWorkspace.tasks).toHaveLength(0);
  });

  it("persists a note against its class", async () => {
    const r = repo();
    const note = await r.createNote(USER, {
      courseId: "course-1",
      kind: "idea",
      body: "  Use the green light for the symbolism essay.  ",
    });
    expect(note.body).toBe("Use the green light for the symbolism essay.");
    expect(note.kind).toBe("idea");
    expect(note.taskId).toBeUndefined();

    const reloaded = await repo().loadWorkspace(USER);
    expect(reloaded.notes.find((n) => n.id === note.id)?.courseId).toBe("course-1");
  });

  it("defaults a note to a thought when no kind is given", async () => {
    const note = await repo().createNote(USER, { body: "Ask about the rubric" });
    expect(note.kind).toBe("thought");
  });

  it("links a note to the task it became, and keeps the note when the task goes", async () => {
    const r = repo();
    const note = await r.createNote(USER, { body: "Ask about extra credit", kind: "idea" });
    const task = await r.createTask(USER, { title: "Ask about extra credit", category: "school" });
    const linked = await r.updateNote(USER, note.id, { taskId: task.id });
    expect(linked.taskId).toBe(task.id);

    await r.deleteTask(USER, task.id);
    const workspace = await r.loadWorkspace(USER);
    expect(workspace.notes.find((n) => n.id === note.id)).toBeTruthy();
  });

  it("deletes a note", async () => {
    const r = repo();
    const note = await r.createNote(USER, { body: "Never mind" });
    await r.deleteNote(USER, note.id);
    expect((await r.loadWorkspace(USER)).notes).toHaveLength(0);
  });

  it("throws a clear error when updating a note that does not exist", async () => {
    await expect(repo().updateNote(USER, "missing", { body: "x" })).rejects.toThrow(/not found/i);
  });

  it("replaces events for a calendar without touching other calendars", async () => {
    const r = repo();
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
    const r = repo();
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
    await r.createTask(USER, { title: "Keep me", category: "personal" });
    const exported = await r.exportWorkspace(USER);
    expect(exported.tasks.length).toBe(1);
    await r.deleteAllData(USER);
    expect((await r.loadWorkspace(USER)).tasks).toHaveLength(0);
  });

  it("recovers from a corrupted storage payload instead of crashing", async () => {
    window.localStorage.setItem(`aaditos:v1:workspace:${USER}`, "{not json");
    const workspace = await repo().loadWorkspace(USER);
    expect(workspace.tasks).toEqual([]);
    expect(workspace.profile.id).toBe(USER);
  });

  it("persists preference changes", async () => {
    const r = repo();
    const workspace = await r.loadWorkspace(USER);
    await r.savePreferences(USER, {
      ...workspace.preferences,
      theme: "dark",
      workdayEnd: "22:00",
    });
    const reloaded = await repo().loadWorkspace(USER);
    expect(reloaded.preferences.theme).toBe("dark");
    expect(reloaded.preferences.workdayEnd).toBe("22:00");
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

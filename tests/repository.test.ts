import { beforeEach, describe, expect, it } from "vitest";

import { stableId } from "@/lib/core/ids";
import { LocalRepository, demoProfile } from "@/lib/repo/local";
import { DEMO_USER_ID, seedCourses, seedNotes } from "@/lib/repo/seed";
import type { CalendarEvent } from "@/lib/core/types";

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
    expect(workspace.notes.length).toBeGreaterThan(0);
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

  it("keeps each user's data separate", async () => {
    const other = stableId("other-user");
    const r = repo(false);
    await r.createTask(USER, { title: "Mine", category: "personal" });
    const otherWorkspace = await new LocalRepository(() => demoProfile(other), false).loadWorkspace(
      other,
    );
    expect(otherWorkspace.tasks).toHaveLength(0);
  });

  it("persists a note against its class", async () => {
    const r = repo(false);
    const note = await r.createNote(USER, {
      courseId: "course-1",
      kind: "idea",
      body: "  Use the green light for the symbolism essay.  ",
    });
    expect(note.body).toBe("Use the green light for the symbolism essay.");
    expect(note.kind).toBe("idea");
    expect(note.taskId).toBeUndefined();

    const reloaded = await repo(false).loadWorkspace(USER);
    expect(reloaded.notes.find((n) => n.id === note.id)?.courseId).toBe("course-1");
  });

  it("defaults a note to a thought when no kind is given", async () => {
    const note = await repo(false).createNote(USER, { body: "Ask about the rubric" });
    expect(note.kind).toBe("thought");
  });

  it("links a note to the task it became, and keeps the note when the task goes", async () => {
    const r = repo(false);
    const note = await r.createNote(USER, { body: "Ask about extra credit", kind: "idea" });
    const task = await r.createTask(USER, { title: "Ask about extra credit", category: "school" });
    const linked = await r.updateNote(USER, note.id, { taskId: task.id });
    expect(linked.taskId).toBe(task.id);

    await r.deleteTask(USER, task.id);
    const workspace = await r.loadWorkspace(USER);
    expect(workspace.notes.find((n) => n.id === note.id)).toBeTruthy();
  });

  it("deletes a note", async () => {
    const r = repo(false);
    const note = await r.createNote(USER, { body: "Never mind" });
    await r.deleteNote(USER, note.id);
    expect((await r.loadWorkspace(USER)).notes).toHaveLength(0);
  });

  it("throws a clear error when updating a note that does not exist", async () => {
    await expect(repo(false).updateNote(USER, "missing", { body: "x" })).rejects.toThrow(
      /not found/i,
    );
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

  it("recovers from a corrupted storage payload instead of crashing", async () => {
    window.localStorage.setItem(`aaditos:v1:workspace:${USER}`, "{not json");
    const workspace = await repo().loadWorkspace(USER);
    expect(workspace.tasks.length).toBeGreaterThan(0);
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
/**
 * Regression: the seeded notes referenced course keys ("english9", "finlit")
 * that no course actually used ("english9h", "financiallit"). Nothing failed —
 * the notes saved, and appeared on Today, and were simply invisible on every
 * class page forever, because their courseId matched no course.
 */
describe("seedNotes", () => {
  it("attaches every note to a course that actually exists", () => {
    const now = new Date("2026-08-14T12:00:00Z");
    const courseIds = new Set(seedCourses("user-a", now).map((c) => c.id));
    const notes = seedNotes("user-a", now);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(courseIds.has(note.courseId ?? "")).toBe(true);
    }
  });

  it("seeds both kinds, so a class page shows what each is for", () => {
    const kinds = new Set(seedNotes("user-a", new Date("2026-08-14T12:00:00Z")).map((n) => n.kind));
    expect(kinds).toEqual(new Set(["thought", "idea"]));
  });
});

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

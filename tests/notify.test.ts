/**
 * What earns an interruption.
 *
 * The rules that matter most are the negative ones: a notification nobody wanted
 * is worse than no notification, because it teaches the user to ignore the
 * channel — or turn it off. So most of what follows pins things that must NOT
 * fire.
 */

import { describe, expect, it } from "vitest";

import { formatLate, pendingAlerts } from "@/lib/notify/engine";
import type { NotificationCategory, Task, Workspace } from "@/lib/core/types";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const USER = "user-1";

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    userId: USER,
    title: "A task",
    category: "school",
    dueAllDay: false,
    priority: "normal",
    status: "todo",
    estimateMin: 30,
    source: "manual",
    subtasks: [],
    position: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...partial,
  } as Task;
}

function workspace(partial: Partial<Workspace>): Workspace {
  return {
    tasks: [],
    notifications: [],
    syncRuns: [],
    courses: [],
    assignments: [],
    events: [],
    projects: [],
    opportunities: [],
    focusSessions: [],
    integrations: [],
    ...partial,
  } as unknown as Workspace;
}

const opts = (over: Partial<Parameters<typeof pendingAlerts>[1]> = {}) => ({
  now: NOW,
  delivered: new Set<string>(),
  muted: new Set<NotificationCategory>(),
  ...over,
});

const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

describe("due-soon alerts", () => {
  it("fires for work due inside the lead window", () => {
    const ws = workspace({
      tasks: [task({ id: "t1", title: "Lab report", dueAt: minutesFromNow(30) })],
    });
    const alerts = pendingAlerts(ws, opts());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.body).toContain("Lab report");
    expect(alerts[0]?.key).toBe("task:t1:due-soon");
  });

  it("stays quiet for work due later today", () => {
    const ws = workspace({ tasks: [task({ id: "t1", dueAt: minutesFromNow(300) })] });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });

  it("marks an urgent task in the title, so the body is not the only signal", () => {
    const ws = workspace({
      tasks: [task({ id: "t1", priority: "urgent", dueAt: minutesFromNow(10) })],
    });
    expect(pendingAlerts(ws, opts())[0]?.title).toMatch(/urgent/i);
  });

  it("never fires for a task with no due date", () => {
    expect(pendingAlerts(workspace({ tasks: [task({ id: "t1" })] }), opts())).toEqual([]);
  });

  it("never fires for done or archived work", () => {
    const ws = workspace({
      tasks: [
        task({ id: "t1", status: "done", dueAt: minutesFromNow(10) }),
        task({ id: "t2", status: "archived", dueAt: minutesFromNow(10) }),
      ],
    });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });

  it("survives an unparseable due date rather than throwing", () => {
    const ws = workspace({ tasks: [task({ id: "t1", dueAt: "not-a-date" })] });
    expect(() => pendingAlerts(ws, opts())).not.toThrow();
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });
});

describe("overdue alerts", () => {
  it("fires once something has slipped past due", () => {
    const ws = workspace({ tasks: [task({ id: "t1", dueAt: minutesFromNow(-30) })] });
    const alerts = pendingAlerts(ws, opts());
    expect(alerts[0]?.key).toBe("task:t1:overdue");
    expect(alerts[0]?.category).toBe("urgent");
  });

  /**
   * Due-soon and overdue are separate keys on purpose: they are two different
   * facts about the task and each is worth saying exactly once.
   */
  it("is a different alert from the due-soon one for the same task", () => {
    const soon = pendingAlerts(
      workspace({ tasks: [task({ id: "t1", dueAt: minutesFromNow(10) })] }),
      opts(),
    );
    const late = pendingAlerts(
      workspace({ tasks: [task({ id: "t1", dueAt: minutesFromNow(-10) })] }),
      opts(),
    );
    expect(soon[0]?.key).not.toBe(late[0]?.key);
  });

  it("goes quiet once the work is long past, instead of nagging forever", () => {
    const ws = workspace({ tasks: [task({ id: "t1", dueAt: minutesFromNow(-60 * 24 * 5) })] });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });
});

describe("suppression", () => {
  it("skips anything already delivered", () => {
    const ws = workspace({ tasks: [task({ id: "t1", dueAt: minutesFromNow(10) })] });
    expect(pendingAlerts(ws, opts({ delivered: new Set(["task:t1:due-soon"]) }))).toEqual([]);
  });

  it("respects a muted category", () => {
    const ws = workspace({
      tasks: [task({ id: "t1", category: "school", dueAt: minutesFromNow(10) })],
    });
    expect(pendingAlerts(ws, opts({ muted: new Set<NotificationCategory>(["school"]) }))).toEqual(
      [],
    );
  });
});

describe("sync failures", () => {
  const run = (over: Record<string, unknown>) => ({
    id: "r1",
    userId: USER,
    provider: "github",
    startedAt: NOW.toISOString(),
    ok: false,
    imported: 0,
    updated: 0,
    skipped: 0,
    ...over,
  });

  it("fires for a real failure", () => {
    const ws = workspace({ syncRuns: [run({ message: "GitHub API returned 500" })] as never });
    const alerts = pendingAlerts(ws, opts());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.href).toBe("/integrations");
  });

  /**
   * An unconfigured provider fails on every single run. Alerting on that would
   * mean a daily notification saying nothing new, which is how a channel gets
   * muted permanently.
   */
  it("stays quiet for a provider whose integration is marked unavailable", () => {
    const ws = workspace({
      syncRuns: [run({ message: "GITHUB_TOKEN is not set on the server" })] as never,
      integrations: [{ id: "github", userId: USER, status: "unavailable" }] as never,
    });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });

  /** The mapping is not identity: the `google` sync writes a `google_calendar` record. */
  it("resolves the integration record through the provider mapping", () => {
    const ws = workspace({
      syncRuns: [run({ provider: "google", message: "Google is not connected yet." })] as never,
      integrations: [{ id: "google_calendar", userId: USER, status: "unavailable" }] as never,
    });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });

  it("still fires when the provider is connected and the run genuinely failed", () => {
    const ws = workspace({
      syncRuns: [run({ message: "GitHub API returned 500" })] as never,
      integrations: [{ id: "github", userId: USER, status: "connected" }] as never,
    });
    expect(pendingAlerts(ws, opts())).toHaveLength(1);
  });

  it("stays quiet for a successful run", () => {
    const ws = workspace({ syncRuns: [run({ ok: true, message: "20 deployments" })] as never });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });

  it("ignores a stale failure from hours ago", () => {
    const old = new Date(NOW.getTime() - 12 * 3_600_000).toISOString();
    const ws = workspace({ syncRuns: [run({ startedAt: old, message: "boom" })] as never });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });
});

describe("passthrough of urgent in-app notifications", () => {
  const notification = (over: Record<string, unknown>) => ({
    id: "n1",
    userId: USER,
    category: "urgent",
    title: "Permission slip due",
    detail: "Advisory, first period",
    source: "manual",
    read: false,
    createdAt: NOW.toISOString(),
    dedupeKey: "slip-1",
    ...over,
  });

  it("fires for an unread urgent item", () => {
    const ws = workspace({ notifications: [notification({})] as never });
    expect(pendingAlerts(ws, opts())[0]?.key).toBe("notification:slip-1");
  });

  it("stays quiet once it has been read", () => {
    const ws = workspace({ notifications: [notification({ read: true })] as never });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });

  it("leaves anything below urgent in the app", () => {
    const ws = workspace({ notifications: [notification({ category: "school" })] as never });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });

  /** On a fresh install the whole backlog would otherwise arrive at once. */
  it("does not announce a backlog older than a day", () => {
    const old = new Date(NOW.getTime() - 48 * 3_600_000).toISOString();
    const ws = workspace({ notifications: [notification({ createdAt: old })] as never });
    expect(pendingAlerts(ws, opts())).toEqual([]);
  });
});

describe("formatLate", () => {
  it("reads naturally at each scale", () => {
    expect(formatLate(45)).toBe("45m");
    expect(formatLate(120)).toBe("2h");
    expect(formatLate(60 * 24 * 3)).toBe("3d");
  });

  it("never says 0m", () => {
    expect(formatLate(0.2)).toBe("1m");
  });
});

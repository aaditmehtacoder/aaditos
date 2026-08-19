/**
 * Builds the compact workspace view the assistant reasons over.
 *
 * Tasks, assignments, events and notes — everything that carries either a
 * deadline or an intention. Notes are included on purpose: without them the
 * assistant can only reason about *when* things are due, never about what the
 * user actually understood, wanted, or got stuck on.
 */

import { availableFocusMinutes } from "@/lib/core/priority";
import { classEventsForDay, formatMin, nextClassFor, schoolDayStatus } from "@/lib/core/schedule";
import { addDays, dateKey, minutesIntoDay, startOfDay } from "@/lib/core/time";
import type { Workspace } from "@/lib/core/types";

import type { CompassSnapshot } from "./types";

const HORIZON_DAYS = 14;

export function buildSnapshot(
  workspace: Workspace,
  now: Date,
  opts: { isDemo: boolean },
): CompassSnapshot {
  const courseName = new Map(workspace.courses.map((c) => [c.id, c.name]));

  const horizonStart = startOfDay(now).getTime();
  const horizonEnd = addDays(startOfDay(now), HORIZON_DAYS).getTime();

  const status = schoolDayStatus(now, workspace.events);
  // Classes only occupy the day when school is actually in session.
  const classEvents = status.isSchoolDay
    ? classEventsForDay(workspace.courses, now, workspace.profile.id)
    : [];
  const next = status.isSchoolDay ? nextClassFor(workspace.courses, now) : null;

  const todayKey = dateKey(now);
  const busy = [...classEvents, ...workspace.events]
    .filter((e) => dateKey(e.startAt) === todayKey && !e.allDay && e.endAt)
    .map((e) => ({
      startMin: minutesIntoDay(e.startAt),
      endMin: minutesIntoDay(e.endAt!),
    }));
  const [startH = 7, startM = 0] = workspace.preferences.workdayStart.split(":").map(Number);
  const [endH = 21, endM = 30] = workspace.preferences.workdayEnd.split(":").map(Number);
  const focusWindow = availableFocusMinutes(busy, {
    nowMin: minutesIntoDay(now),
    dayStartMin: startH * 60 + startM,
    dayEndMin: endH * 60 + endM,
  });

  return {
    now: now.toISOString(),
    timezone: workspace.profile.timezone,
    profile: {
      name: workspace.profile.name,
      grade: workspace.profile.grade,
      school: workspace.profile.school,
      city: workspace.profile.city,
    },
    schoolDay: {
      isSchoolDay: status.isSchoolDay,
      reason: status.reason,
      nextClass: next ? `${next.course.name} at ${formatMin(next.slot.startMin)}` : undefined,
    },
    availableMin: focusWindow.totalMin,
    isDemo: opts.isDemo,
    courses: workspace.courses.filter((c) => c.active).map((c) => c.name),
    tasks: workspace.tasks
      .filter((t) => t.status !== "archived" && !t.deletedAt)
      .slice(0, 80)
      .map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        priority: t.priority,
        status: t.status,
        estimateMin: t.estimateMin,
        dueAt: t.dueAt,
        dueAllDay: t.dueAllDay,
        course: t.courseId ? courseName.get(t.courseId) : undefined,
        subtasksOpen: t.subtasks.filter((s) => !s.done).length,
      })),
    assignments: workspace.assignments.slice(0, 60).map((a) => ({
      id: a.id,
      title: a.title,
      course: a.courseId ? courseName.get(a.courseId) : undefined,
      state: a.state,
      dueAt: a.dueAt,
      estimateMin: a.estimateMin,
      grade: a.grade,
      url: a.externalUrl,
    })),
    events: [...classEvents, ...workspace.events]
      .filter((e) => {
        const t = new Date(e.startAt).getTime();
        return t >= horizonStart && t <= horizonEnd;
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 80)
      .map((e) => ({
        id: e.id,
        title: e.title,
        startAt: e.startAt,
        endAt: e.endAt,
        allDay: e.allDay,
        kind: e.kind,
        source: e.source,
        location: e.location,
      })),
    notes: workspace.notes.slice(0, 60).map((n) => ({
      id: n.id,
      course: n.courseId ? courseName.get(n.courseId) : undefined,
      kind: n.kind,
      body: n.body,
      createdAt: n.createdAt,
      madeIntoTask: Boolean(n.taskId),
    })),
  };
}

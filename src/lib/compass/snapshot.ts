/**
 * Builds the compact workspace view that Compass reasons over.
 *
 * Only what is needed to answer "what is happening today / what matters / what
 * next" is included; free-text notes and anything not needed for planning stay
 * on the device.
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
  const projectName = new Map(workspace.projects.map((p) => [p.id, p.name]));

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

  const weekAgo = now.getTime() - 7 * 86_400_000;
  const recentSessions = workspace.focusSessions.filter(
    (s) => s.status === "completed" && new Date(s.startedAt).getTime() >= weekAgo,
  );
  const byCategory: Record<string, number> = {};
  for (const session of recentSessions) {
    byCategory[session.category] =
      (byCategory[session.category] ?? 0) + Math.round(session.elapsedSec / 60);
  }

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
        project: t.projectId ? projectName.get(t.projectId) : undefined,
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
    projects: workspace.projects.map((p) => ({
      id: p.id,
      name: p.name,
      objective: p.objective,
      health: p.health,
      progress: p.progress,
      blockers: p.blockers,
      deadlineAt: p.deadlineAt,
      openTasks: workspace.tasks.filter(
        (t) => t.projectId === p.id && t.status !== "done" && t.status !== "archived",
      ).length,
      recentActivity: p.activity.slice(0, 4).map((a) => a.text),
    })),
    opportunities: workspace.opportunities.map((o) => ({
      id: o.id,
      org: o.org,
      title: o.title,
      type: o.type,
      stage: o.stage,
      deadlineAt: o.deadlineAt,
      nextAction: o.nextAction,
    })),
    focus: {
      last7DaysMin: recentSessions.reduce((sum, s) => sum + Math.round(s.elapsedSec / 60), 0),
      byCategory,
      sessionCount: recentSessions.length,
      longestSessionMin: recentSessions.reduce(
        (max, s) => Math.max(max, Math.round(s.elapsedSec / 60)),
        0,
      ),
    },
  };
}

/**
 * The single derivation of "today".
 *
 * Every page that answers *what is happening today / what matters now / what
 * next* reads from here, so the Today page, Compass and the command palette can
 * never disagree with each other.
 */

import { useMemo } from "react";

import { dedupeEvents, findConflicts } from "@/lib/core/normalize";
import { availableFocusMinutes, nextMove, rankTasks, type RankedTask } from "@/lib/core/priority";
import {
  classEventsForDay,
  nextClassFor,
  schoolDayStatus,
  type BellPeriod,
  type SchoolDayStatus,
} from "@/lib/core/schedule";
import { addDays, dateKey, dayDiff, endOfWeek, minutesIntoDay, startOfWeek } from "@/lib/core/time";
import type { CalendarEvent, Course, Task } from "@/lib/core/types";
import { useOS } from "@/lib/store";

export interface TodayModel {
  now: Date;
  school: SchoolDayStatus;
  nextClass: { course: Course; slot: BellPeriod } | null;
  /** Class blocks plus every calendar event for today, deduplicated and sorted. */
  timeline: CalendarEvent[];
  conflicts: ReturnType<typeof findConflicts>;
  ranked: RankedTask[];
  next: RankedTask | null;
  mustDoToday: Task[];
  overdue: Task[];
  upcoming: Task[];
  availableMin: number;
  nextWindowMin: number;
  weekly: {
    plannedTasks: number;
    completedTasks: number;
    focusMin: number;
    focusGoalMin: number;
    taskGoal: number;
  };
}

export function useToday(): TodayModel {
  const { workspace, now } = useOS();

  return useMemo(() => {
    const school = schoolDayStatus(now, workspace.events);
    const classes = school.isSchoolDay
      ? classEventsForDay(workspace.courses, now, workspace.profile.id)
      : [];
    const todayKey = dateKey(now);

    const todaysEvents = workspace.events.filter((e) => dateKey(e.startAt) === todayKey);
    const timeline = dedupeEvents([...classes, ...todaysEvents]).events;
    const conflicts = findConflicts(timeline);

    const busy = timeline
      .filter((e) => !e.allDay && e.endAt)
      .map((e) => ({ startMin: minutesIntoDay(e.startAt), endMin: minutesIntoDay(e.endAt!) }));

    const [startH = 7, startM = 0] = workspace.preferences.workdayStart.split(":").map(Number);
    const [endH = 21, endM = 30] = workspace.preferences.workdayEnd.split(":").map(Number);
    const windows = availableFocusMinutes(busy, {
      nowMin: minutesIntoDay(now),
      dayStartMin: startH * 60 + startM,
      dayEndMin: endH * 60 + endM,
    });

    const ranked = rankTasks(workspace.tasks, {
      now,
      availableMin: windows.nextWindowMin || windows.totalMin,
      schoolDay: school.isSchoolDay,
      schoolEndsAtMin: school.dayEndMin,
    });

    const open = workspace.tasks.filter(
      (t) => t.status !== "done" && t.status !== "archived" && !t.deletedAt,
    );
    const mustDoToday = open
      .filter((t) => t.dueAt && dayDiff(now, t.dueAt) <= 0)
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
    const overdue = mustDoToday.filter((t) => dayDiff(now, t.dueAt!) < 0);
    const upcoming = open
      .filter((t) => t.dueAt && dayDiff(now, t.dueAt) > 0 && dayDiff(now, t.dueAt) <= 7)
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());

    const weekStart = startOfWeek(now).getTime();
    const weekEnd = endOfWeek(now).getTime();
    const completedThisWeek = workspace.tasks.filter(
      (t) =>
        t.status === "done" &&
        t.completedAt &&
        new Date(t.completedAt).getTime() >= weekStart &&
        new Date(t.completedAt).getTime() <= weekEnd,
    ).length;
    const plannedThisWeek =
      completedThisWeek +
      open.filter((t) => !t.dueAt || new Date(t.dueAt).getTime() <= weekEnd).length;
    const focusMin = workspace.focusSessions
      .filter(
        (s) =>
          s.status === "completed" &&
          new Date(s.startedAt).getTime() >= weekStart &&
          new Date(s.startedAt).getTime() <= weekEnd,
      )
      .reduce((sum, s) => sum + Math.round(s.elapsedSec / 60), 0);

    return {
      now,
      school,
      nextClass: school.isSchoolDay ? nextClassFor(workspace.courses, now) : null,
      timeline,
      conflicts,
      ranked,
      next: ranked[0] ?? null,
      mustDoToday,
      overdue,
      upcoming,
      availableMin: windows.totalMin,
      nextWindowMin: windows.nextWindowMin,
      weekly: {
        plannedTasks: plannedThisWeek,
        completedTasks: completedThisWeek,
        focusMin,
        focusGoalMin: workspace.preferences.focusGoalHours * 60,
        taskGoal: workspace.preferences.weeklyTaskGoal,
      },
    };
  }, [workspace, now]);
}

export function useNextMove(): RankedTask | null {
  const { workspace, now } = useOS();
  const model = useToday();
  return useMemo(
    () =>
      nextMove(workspace.tasks, {
        now,
        availableMin: model.nextWindowMin || model.availableMin,
        schoolDay: model.school.isSchoolDay,
      }),
    [workspace.tasks, now, model.nextWindowMin, model.availableMin, model.school.isSchoolDay],
  );
}

export function upcomingEvents(events: CalendarEvent[], now: Date, days: number): CalendarEvent[] {
  const end = addDays(now, days).getTime();
  return events
    .filter((e) => {
      const t = new Date(e.startAt).getTime();
      return t >= now.getTime() && t <= end;
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

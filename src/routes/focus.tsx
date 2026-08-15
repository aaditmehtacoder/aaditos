import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Check, Pause, Play, Timer, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { SpotifyPanel } from "@/components/os/spotify-panel";
import {
  ChartSummary,
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  ProgressBar,
  SectionLabel,
  Stat,
} from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { rankTasks } from "@/lib/core/priority";
import {
  addDays,
  dateKey,
  formatClock,
  formatDuration,
  formatTime,
  formatWeekday,
  relativeDayLabel,
  startOfWeek,
  zonedParts,
} from "@/lib/core/time";
import type { TaskCategory } from "@/lib/core/types";
import { useFocusTimer } from "@/lib/hooks/use-focus-timer";
import { useToday } from "@/lib/hooks/use-today";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

const searchSchema = z.object({ taskId: z.string().optional() });

export const Route = createFileRoute("/focus")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Focus · AaditOS" },
      { name: "description", content: "Timed focus sessions and weekly focus analytics." },
    ],
  }),
  component: FocusPage,
});

const DURATIONS = [15, 25, 30, 45, 50, 60, 90];

function FocusPage() {
  const { workspace, now } = useOS();
  const navigate = useNavigate();
  const search = useSearch({ from: "/focus" });
  const timer = useFocusTimer();
  const { availableMin, nextWindowMin } = useToday();

  const openTasks = useMemo(
    () =>
      rankTasks(workspace.tasks, {
        now,
        availableMin: nextWindowMin || availableMin,
        schoolDay: false,
      }),
    [workspace.tasks, now, nextWindowMin, availableMin],
  );

  const [taskId, setTaskId] = useState<string>(search.taskId ?? openTasks[0]?.task.id ?? "");
  const [plannedMin, setPlannedMin] = useState(25);
  const [reflection, setReflection] = useState("");
  const [justFinished, setJustFinished] = useState<{ minutes: number; title: string } | null>(null);

  useEffect(() => {
    if (search.taskId) setTaskId(search.taskId);
  }, [search.taskId]);

  useEffect(() => {
    if (!taskId && openTasks[0]) setTaskId(openTasks[0].task.id);
  }, [taskId, openTasks]);

  const selectedTask = workspace.tasks.find((t) => t.id === taskId);
  const session = timer.session;
  const plannedSec = (session?.plannedMin ?? plannedMin) * 60;
  const progress = plannedSec > 0 ? Math.min(100, (timer.elapsedSec / plannedSec) * 100) : 0;
  const overtime = timer.elapsedSec > plannedSec;

  const analytics = useWeeklyAnalytics();

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="pb-5">
        <h1 className="display text-[23px]">Focus</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {formatDuration(availableMin)} available today
          {nextWindowMin > 0 ? ` · next open block ${formatDuration(nextWindowMin)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel className="p-5">
          {session ? (
            <div>
              <div className="flex items-center gap-2">
                <Pill tone={session.status === "running" ? "primary" : "warning"}>
                  {session.status === "running" ? "Running" : "Paused"}
                </Pill>
                {timer.restored ? <Pill tone="neutral">Restored after refresh</Pill> : null}
                {overtime ? <Pill tone="warning">Over plan</Pill> : null}
              </div>

              <p className="mt-3 truncate text-[14px] font-medium">{session.taskTitle}</p>

              <p
                className="mt-2 text-[44px] font-semibold leading-none tabular-nums tracking-tight"
                role="timer"
                aria-live="off"
              >
                {formatClock(timer.elapsedSec)}
              </p>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                Planned {formatDuration(session.plannedMin)} · started{" "}
                {formatTime(session.startedAt)}
              </p>

              <div className="mt-3">
                <ProgressBar
                  value={progress}
                  label="Session progress"
                  tone={overtime ? "warning" : "primary"}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {session.status === "running" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-[12.5px]"
                    onClick={timer.pause}
                  >
                    <Pause className="size-3.5" aria-hidden /> Pause
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={timer.resume}>
                    <Play className="size-3.5" aria-hidden /> Resume
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-[12.5px]"
                  onClick={() => {
                    void timer.finish(reflection).then((done) => {
                      if (done) {
                        setJustFinished({
                          minutes: Math.round(done.elapsedSec / 60),
                          title: done.taskTitle,
                        });
                        setReflection("");
                        toast.success("Focus session saved", {
                          description: `${formatDuration(Math.round(done.elapsedSec / 60))} on ${done.taskTitle}`,
                        });
                      }
                    });
                  }}
                >
                  <Check className="size-3.5" aria-hidden /> Finish
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-[12.5px]"
                  onClick={() => {
                    void timer.cancel();
                    toast("Session cancelled");
                  }}
                >
                  <X className="size-3.5" aria-hidden /> Cancel
                </Button>
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <label
                  htmlFor="reflection"
                  className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground"
                >
                  Reflection (optional)
                </label>
                <Textarea
                  id="reflection"
                  rows={2}
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  placeholder="What worked, what got in the way?"
                  className="text-[12.5px]"
                />
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Start a session
              </p>

              {openTasks.length === 0 ? (
                <EmptyState
                  icon={Timer}
                  title="No open tasks"
                  description="Add a task first — focus sessions are always attached to something real."
                />
              ) : (
                <>
                  <div className="mt-3 space-y-3">
                    <div>
                      <label
                        htmlFor="focus-task"
                        className="mb-1.5 block text-[12px] text-muted-foreground"
                      >
                        Task
                      </label>
                      <Select value={taskId} onValueChange={setTaskId}>
                        <SelectTrigger id="focus-task" className="h-9 text-[13px]">
                          <SelectValue placeholder="Pick a task" />
                        </SelectTrigger>
                        <SelectContent>
                          {openTasks.slice(0, 25).map(({ task }) => (
                            <SelectItem key={task.id} value={task.id}>
                              {task.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <fieldset>
                      <legend className="mb-1.5 text-[12px] text-muted-foreground">
                        Planned length
                      </legend>
                      <div className="flex flex-wrap gap-1.5">
                        {DURATIONS.map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            aria-pressed={plannedMin === minutes}
                            onClick={() => setPlannedMin(minutes)}
                            className={cn(
                              "rounded-[9px] border px-2.5 py-1 text-[12.5px] tabular-nums transition-colors duration-150",
                              plannedMin === minutes
                                ? "border-primary bg-primary-soft text-primary"
                                : "border-border text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {minutes}m
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </div>

                  {selectedTask ? (
                    <p className="mt-3 text-[12px] text-muted-foreground">
                      {selectedTask.estimateMin > plannedMin
                        ? `This task is estimated at ${formatDuration(selectedTask.estimateMin)} — you may need more than one session.`
                        : `Estimated at ${formatDuration(selectedTask.estimateMin)}, so one session should cover it.`}
                    </p>
                  ) : null}

                  <Button
                    className="mt-4 h-9 w-full gap-1.5 text-[13px]"
                    disabled={!selectedTask}
                    onClick={() => {
                      if (!selectedTask) return;
                      timer.start({
                        taskId: selectedTask.id,
                        taskTitle: selectedTask.title,
                        category: selectedTask.category as TaskCategory,
                        plannedMin,
                      });
                      setJustFinished(null);
                      void navigate({ to: "/focus", search: {}, replace: true });
                    }}
                  >
                    <Play className="size-4" aria-hidden /> Start {plannedMin}-minute session
                  </Button>
                </>
              )}

              {justFinished ? (
                <div className="mt-4 rounded-[12px] border border-success/30 bg-success-soft px-3 py-2.5">
                  <p className="text-[12.5px] font-medium text-success-strong">
                    Saved {formatDuration(justFinished.minutes)} on {justFinished.title}
                  </p>
                  {openTasks[0] ? (
                    <p className="mt-1 text-[12px] text-success-strong">
                      Suggested next: {openTasks[0].task.title} (
                      {formatDuration(openTasks[0].task.estimateMin)})
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Suggested next" meta="Ranked by deadline, priority and fit" />
          {openTasks.length === 0 ? (
            <EmptyState title="Nothing to suggest" description="Every task is done." />
          ) : (
            <ol className="divide-y divide-border">
              {openTasks.slice(0, 6).map(({ task, reasons, fitsAvailableTime }) => (
                <li
                  key={task.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium">{task.title}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {reasons[0] ?? "No deadline"} · {formatDuration(task.estimateMin)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-[11.5px]"
                    disabled={Boolean(session)}
                    title={session ? "Finish the current session first" : undefined}
                    onClick={() => {
                      timer.start({
                        taskId: task.id,
                        taskTitle: task.title,
                        category: task.category,
                        plannedMin: fitsAvailableTime ? Math.min(task.estimateMin, 60) : 25,
                      });
                    }}
                  >
                    Focus
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <SpotifyPanel />
      </div>

      <WeeklyAnalytics analytics={analytics} />
    </div>
  );
}

interface WeeklyAnalytics {
  totalMin: number;
  sessionCount: number;
  byCategory: Array<{ category: string; minutes: number }>;
  byDay: Array<{ day: string; minutes: number }>;
  plannedMin: number;
  completedMin: number;
  bestHour: string | null;
  recent: Array<{
    id: string;
    title: string;
    minutes: number;
    plannedMin: number;
    startedAt: string;
    status: string;
  }>;
}

function useWeeklyAnalytics(): WeeklyAnalytics {
  const { workspace, now } = useOS();

  return useMemo(() => {
    const weekStart = startOfWeek(now);
    const sessions = workspace.focusSessions.filter(
      (s) => new Date(s.startedAt).getTime() >= weekStart.getTime(),
    );
    const completed = sessions.filter((s) => s.status === "completed");

    const byCategory = new Map<string, number>();
    const byHour = new Map<number, number>();
    for (const session of completed) {
      const minutes = Math.round(session.elapsedSec / 60);
      byCategory.set(session.category, (byCategory.get(session.category) ?? 0) + minutes);
      const hour = zonedParts(session.startedAt).hour;
      byHour.set(hour, (byHour.get(hour) ?? 0) + minutes);
    }

    const byDay = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const key = dateKey(day);
      const minutes = completed
        .filter((s) => dateKey(s.startedAt) === key)
        .reduce((sum, s) => sum + Math.round(s.elapsedSec / 60), 0);
      return { day: formatWeekday(day), minutes };
    });

    let bestHour: string | null = null;
    let bestMinutes = 0;
    for (const [hour, minutes] of byHour) {
      if (minutes > bestMinutes) {
        bestMinutes = minutes;
        const h12 = hour % 12 === 0 ? 12 : hour % 12;
        bestHour = `${h12} ${hour >= 12 ? "PM" : "AM"}`;
      }
    }

    return {
      totalMin: completed.reduce((sum, s) => sum + Math.round(s.elapsedSec / 60), 0),
      sessionCount: completed.length,
      byCategory: Array.from(byCategory.entries()).map(([category, minutes]) => ({
        category,
        minutes,
      })),
      byDay,
      plannedMin: sessions.reduce((sum, s) => sum + s.plannedMin, 0),
      completedMin: completed.reduce((sum, s) => sum + Math.round(s.elapsedSec / 60), 0),
      bestHour,
      recent: sessions
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, 8)
        .map((s) => ({
          id: s.id,
          title: s.taskTitle,
          minutes: Math.round(s.elapsedSec / 60),
          plannedMin: s.plannedMin,
          startedAt: s.startedAt,
          status: s.status,
        })),
    };
  }, [workspace.focusSessions, now]);
}

const CATEGORY_COLOR: Record<string, string> = {
  school: "bg-chart-1",
  work: "bg-chart-2",
  personal: "bg-chart-3",
};

function WeeklyAnalytics({ analytics }: { analytics: WeeklyAnalytics }) {
  const { workspace } = useOS();
  const goalMin = workspace.preferences.focusGoalHours * 60;
  const maxDay = Math.max(60, ...analytics.byDay.map((d) => d.minutes));

  return (
    <div className="mt-4 space-y-4">
      <Panel>
        <PanelHeader title="This week" meta="Completed sessions only" />
        <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          <Stat
            label="Total focus"
            value={formatDuration(analytics.totalMin)}
            hint={`Goal ${formatDuration(goalMin)}`}
          />
          <Stat label="Sessions" value={String(analytics.sessionCount)} />
          <Stat
            label="Planned vs done"
            value={
              analytics.plannedMin > 0
                ? `${Math.round((analytics.completedMin / analytics.plannedMin) * 100)}%`
                : "—"
            }
            hint={`${formatDuration(analytics.completedMin)} of ${formatDuration(analytics.plannedMin)}`}
          />
          <Stat
            label="Most productive"
            value={analytics.bestHour ?? "—"}
            hint="By minutes logged"
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Focus by day" />
          {analytics.totalMin === 0 ? (
            <EmptyState
              title="No completed sessions this week"
              description="Finish a session and it will appear here. Nothing is estimated or filled in."
            />
          ) : (
            <>
              <div className="flex items-end gap-2 px-4 py-4" style={{ height: 148 }}>
                {analytics.byDay.map((day) => (
                  <div key={day.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10.5px] tabular-nums text-muted-foreground">
                      {day.minutes > 0 ? day.minutes : ""}
                    </span>
                    <div
                      className="w-full rounded-t-[4px] bg-primary/80 transition-[height] duration-200"
                      style={{ height: `${Math.max(2, (day.minutes / maxDay) * 96)}px` }}
                      role="img"
                      aria-label={`${day.day}: ${day.minutes} minutes`}
                    />
                    <span className="text-[10.5px] text-muted-foreground">{day.day}</span>
                  </div>
                ))}
              </div>
              <ChartSummary
                summary={`${formatDuration(analytics.totalMin)} of focus across ${analytics.sessionCount} completed sessions this week.`}
                rows={analytics.byDay.map((d) => `${d.day}: ${d.minutes} minutes`)}
              />
            </>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Time by category" />
          {analytics.byCategory.length === 0 ? (
            <EmptyState
              title="Nothing logged"
              description="Categories appear once you finish sessions."
            />
          ) : (
            <>
              <div className="space-y-3 px-4 py-4">
                {analytics.byCategory.map((entry) => {
                  const pct =
                    analytics.totalMin > 0 ? (entry.minutes / analytics.totalMin) * 100 : 0;
                  return (
                    <div key={entry.category}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="capitalize">{entry.category}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatDuration(entry.minutes)} · {Math.round(pct)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            CATEGORY_COLOR[entry.category] ?? "bg-primary",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <ChartSummary
                summary="Share of this week's completed focus time by category."
                rows={analytics.byCategory.map(
                  (c) =>
                    `${c.category}: ${c.minutes} minutes (${Math.round((c.minutes / Math.max(1, analytics.totalMin)) * 100)}%)`,
                )}
              />
            </>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Recent sessions" meta={`${analytics.recent.length}`} />
        {analytics.recent.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="Your completed sessions are stored and shown here."
          />
        ) : (
          <>
            <SectionLabel>This week</SectionLabel>
            <ul className="divide-y divide-border">
              {analytics.recent.map((session) => (
                <li
                  key={session.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px]">{session.title}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {relativeDayLabel(session.startedAt)} · {formatTime(session.startedAt)} ·
                      planned {formatDuration(session.plannedMin)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[12px] tabular-nums">
                      {formatDuration(session.minutes)}
                    </span>
                    <Pill
                      tone={
                        session.status === "completed"
                          ? "success"
                          : session.status === "cancelled"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {session.status}
                    </Pill>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

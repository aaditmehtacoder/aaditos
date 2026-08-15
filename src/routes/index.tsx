import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DayPlanner } from "@/components/os/day-planner";
import { chord, useModifierKey } from "@/components/os/kbd";
import {
  ChartSummary,
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  ProgressBar,
  RowSkeleton,
  SectionLabel,
} from "@/components/os/primitives";
import { TaskRow } from "@/components/os/task-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateCompact, formatDuration, formatTime, relativeDayLabel } from "@/lib/core/time";
import type { Task } from "@/lib/core/types";
import { useToday } from "@/lib/hooks/use-today";
import { useWeather } from "@/lib/integrations/use-integrations";
import { WeatherGlyph } from "@/components/os/weather-glyph";
import { useOS } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today · AaditOS" },
      {
        name: "description",
        content: "Your day at a glance: next move, plan, must-do tasks and focus time.",
      },
    ],
  }),
  component: TodayPage,
});

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Los_Angeles",
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function NextMoveCard() {
  const { next, availableMin, nextWindowMin } = useToday();
  const { toggleTask, workspace } = useOS();

  if (!next) {
    return (
      <Panel className="rise">
        <PanelHeader title="Next move" />
        <EmptyState
          icon={CheckCircle2}
          title="Nothing left to rank"
          description="Every task is done or archived. Add something with Quick add, or enjoy the gap."
        />
      </Panel>
    );
  }

  const task = next.task;
  const course = workspace.courses.find((c) => c.id === task.courseId);
  const project = workspace.projects.find((p) => p.id === task.projectId);
  const context = course?.name ?? project?.name;

  return (
    <Panel className="rise p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-primary">Next move</h2>
        <Pill tone={next.fitsAvailableTime ? "primary" : "warning"}>
          {next.fitsAvailableTime
            ? `Fits your next ${formatDuration(nextWindowMin || availableMin)}`
            : "Longer than your next window"}
        </Pill>
      </div>

      <h3 className="mt-2.5 text-[17px] font-semibold leading-snug tracking-tight">{task.title}</h3>

      <ul className="mt-2.5 space-y-1">
        {next.reasons.slice(0, 3).map((reason, i) => (
          <li
            key={reason}
            style={{ "--i": i + 1 } as React.CSSProperties}
            className="rise-fast flex items-start gap-2 text-[12.5px] text-muted-foreground"
          >
            <span
              aria-hidden
              className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/50"
            />
            {reason}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[12px] text-muted-foreground">
        {formatDuration(task.estimateMin)}
        {context ? ` · ${context}` : ""}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" className="h-8 text-[12.5px]" asChild>
          <Link to="/focus" search={{ taskId: task.id }}>
            Start focus session
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[12.5px]"
          onClick={() => {
            void toggleTask(task.id);
            toast.success("Marked complete", { description: task.title });
          }}
        >
          Mark complete
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-[12.5px]" asChild>
          <Link to="/compass" search={{ q: `Break down "${task.title}" into steps` }}>
            <Sparkles className="size-[13px]" aria-hidden /> Ask Compass
          </Link>
        </Button>
      </div>
    </Panel>
  );
}

function MustDoToday() {
  const { mustDoToday, overdue } = useToday();
  const { workspace } = useOS();
  const modifier = useModifierKey();

  const groups: Array<{ label: string; key: Task["category"] }> = [
    { label: "School", key: "school" },
    { label: "Work", key: "work" },
    { label: "Personal", key: "personal" },
  ];

  let row = 0;

  return (
    <Panel className="rise" style={{ "--i": 1 } as React.CSSProperties}>
      <PanelHeader
        title="Must do today"
        meta={`${mustDoToday.length} open${overdue.length ? ` · ${overdue.length} overdue` : ""}`}
        action={
          <Link
            to="/tasks"
            className="-mr-1.5 inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:text-foreground"
          >
            All tasks <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      />
      {mustDoToday.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing is due today"
          description={
            workspace.tasks.length === 0
              ? `Add your first task with Quick add — or press ${chord(modifier, "J")}.`
              : "Everything due today is done. Look at This week for what is coming."
          }
        />
      ) : (
        groups.map((group) => {
          const list = mustDoToday.filter((t) => t.category === group.key);
          if (list.length === 0) return null;
          return (
            <div key={group.key} className="border-b border-border last:border-b-0">
              <SectionLabel>{group.label}</SectionLabel>
              <div className="divide-y divide-border">
                {list.map((task) => {
                  row += 1;
                  return <TaskRow key={task.id} task={task} showReorder dense index={row} />;
                })}
              </div>
            </div>
          );
        })
      )}
    </Panel>
  );
}

/** Time, weather, school status and available focus time in one quiet block. */
function ContextCard() {
  const { now, school, nextClass, availableMin, nextWindowMin } = useToday();
  const { profile } = useOS();
  const weather = useWeather();

  return (
    <Panel className="rise p-4" style={{ "--i": 2 } as React.CSSProperties}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-[20px] font-semibold tabular-nums tracking-tight">{formatTime(now)}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {formatDateCompact(now)}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">{profile.city}</p>
        </div>
        {/* Temperature first and largest — it is the only number anyone reads
            at a glance. The condition and the day's range sit under it. */}
        <div className="text-right">
          {weather.isLoading ? (
            <div aria-hidden className="shimmer ml-auto h-4 w-16 rounded-full" />
          ) : weather.data?.ok ? (
            <>
              <p className="flex items-center justify-end gap-1.5 text-[20px] font-semibold tabular-nums tracking-tight">
                <WeatherGlyph
                  code={weather.data.code}
                  isDay={weather.data.isDay}
                  className="size-[18px] text-muted-foreground"
                />
                {weather.data.tempF}°
              </p>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {weather.data.condition}
              </p>
              <p className="truncate text-[12px] tabular-nums text-muted-foreground">
                H {weather.data.highF}° · L {weather.data.lowF}°
              </p>
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">Weather unavailable</p>
          )}
        </div>
      </div>

      <dl className="mt-3.5 space-y-2 border-t border-border pt-3.5 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">School</dt>
          <dd className="min-w-0 truncate text-right">{school.reason}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Next class</dt>
          <dd className="min-w-0 truncate text-right">
            {nextClass ? `${nextClass.course.name} · ${nextClass.course.room}` : "None today"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Focus time</dt>
          <dd className="text-right tabular-nums">
            {formatDuration(availableMin)}
            {nextWindowMin > 0 ? (
              <span className="text-muted-foreground"> · next {formatDuration(nextWindowMin)}</span>
            ) : null}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function QuickCapture() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const { createTask } = useOS();

  return (
    <form
      className="flex items-center gap-2 rounded-[14px] border border-dashed border-border px-3 py-1.5 transition-colors duration-[var(--dur-base)] focus-within:border-primary/40"
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title || busy) return;
        setBusy(true);
        void createTask({ title, category: "personal", estimateMin: 15, priority: "low" })
          .then((created) => {
            if (created) {
              toast.success("Captured to your task inbox");
              setValue("");
            }
          })
          .finally(() => setBusy(false));
      }}
    >
      <label htmlFor="quick-capture" className="sr-only">
        Capture a task
      </label>
      <Input
        id="quick-capture"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Capture something…"
        className="h-8 border-0 bg-transparent px-0 text-[12.5px] shadow-none focus-visible:ring-0"
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        type="submit"
        disabled={!value.trim() || busy}
        aria-label="Capture task"
      >
        <Send className="size-3.5" />
      </Button>
    </form>
  );
}

function RightRail() {
  const { upcoming, weekly } = useToday();

  const taskPct = weekly.taskGoal > 0 ? (weekly.completedTasks / weekly.taskGoal) * 100 : 0;
  const focusPct = weekly.focusGoalMin > 0 ? (weekly.focusMin / weekly.focusGoalMin) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <ContextCard />

      <Panel className="rise" style={{ "--i": 3 } as React.CSSProperties}>
        <PanelHeader title="Coming up" meta="Next 7 days" />
        {upcoming.length === 0 ? (
          <EmptyState
            title="Nothing due this week"
            description="Deadlines from tasks, Classroom and your calendars show up here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.slice(0, 6).map((task, i) => (
              <li
                key={task.id}
                style={{ "--i": i } as React.CSSProperties}
                className="rise-fast grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 px-4 py-2.5"
              >
                {/* Two lines, not an ellipsis: this rail is 296px on a 1366px
                    Chromebook, and most assignment titles lose their subject
                    to a single-line truncation. */}
                <span className="line-clamp-2 text-[12.5px] leading-snug">{task.title}</span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {relativeDayLabel(task.dueAt!)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="rise" style={{ "--i": 4 } as React.CSSProperties}>
        <div className="p-4 pb-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            This week
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <div className="mb-1.5 flex justify-between text-[12px]">
                <span className="text-muted-foreground">Tasks completed</span>
                <span className="tabular-nums">
                  {weekly.completedTasks}/{weekly.taskGoal}
                </span>
              </div>
              <ProgressBar value={taskPct} label="Tasks completed this week" />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-[12px]">
                <span className="text-muted-foreground">Focus hours</span>
                <span className="tabular-nums">
                  {(weekly.focusMin / 60).toFixed(1)}/{(weekly.focusGoalMin / 60).toFixed(0)}
                </span>
              </div>
              <ProgressBar value={focusPct} label="Focus hours this week" tone="success" />
            </div>
          </div>
        </div>
        <ChartSummary
          summary={`This week you completed ${weekly.completedTasks} of a ${weekly.taskGoal} task goal and logged ${(weekly.focusMin / 60).toFixed(1)} of ${(weekly.focusGoalMin / 60).toFixed(0)} focus hours.`}
          rows={[
            `Tasks completed: ${weekly.completedTasks} of ${weekly.taskGoal} (${Math.round(taskPct)}%)`,
            `Focus: ${weekly.focusMin} minutes of ${weekly.focusGoalMin} (${Math.round(focusPct)}%)`,
          ]}
        />
      </Panel>

      <QuickCapture />
    </div>
  );
}

function TodayPage() {
  const { status, error, retry, profile, now, workspace, isDemo } = useOS();
  const { mustDoToday, availableMin, school } = useToday();

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[1400px]">
        <div aria-hidden className="pb-6">
          <div className="shimmer h-6 w-64 rounded-full" />
          <div className="shimmer mt-2.5 h-4 w-96 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_296px]">
          <Panel>
            <RowSkeleton rows={4} />
          </Panel>
          <Panel>
            <RowSkeleton rows={6} />
          </Panel>
          <Panel className="hidden xl:block">
            <RowSkeleton rows={5} />
          </Panel>
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          Loading your day
        </span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <Panel className="mx-auto max-w-lg">
        <PanelHeader title="Could not load your workspace" />
        <div className="px-4 py-6 text-center">
          <p className="text-[12.5px] text-muted-foreground">{error}</p>
          <Button size="sm" className="mt-4 h-8 text-[12.5px]" onClick={retry}>
            Try again
          </Button>
        </div>
      </Panel>
    );
  }

  const firstName = profile.name.split(" ")[0] ?? "there";
  const openCount = workspace.tasks.filter(
    (t) => t.status !== "done" && t.status !== "archived",
  ).length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="fade pb-6">
        <h1 className="display text-[25px]">
          {greeting(now)}, {firstName}.
        </h1>
        <p className="mt-1.5 max-w-3xl text-[13px] text-muted-foreground">
          {school.reason}. {mustDoToday.length} due today, {openCount} open in total, and{" "}
          {formatDuration(availableMin)} of focus time available.
          {isDemo ? " You are exploring demo data." : ""}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_296px]">
        <div className="flex flex-col gap-4">
          <NextMoveCard />
          <MustDoToday />
        </div>
        <div className="flex min-h-[440px] flex-col xl:h-[calc(100vh-190px)] xl:min-h-0">
          <DayPlanner />
        </div>
        <RightRail />
      </div>
    </div>
  );
}

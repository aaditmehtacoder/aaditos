import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, CheckCircle2, Lightbulb } from "lucide-react";

import { CaptureBar } from "@/components/os/capture-bar";
import { EmptyState, Panel, PanelHeader, Pill, RowSkeleton } from "@/components/os/primitives";
import { TaskRow } from "@/components/os/task-row";
import { WeatherGlyph } from "@/components/os/weather-glyph";
import { Button } from "@/components/ui/button";
import { formatDuration, formatTime, relativeDayLabel } from "@/lib/core/time";
import type { Task } from "@/lib/core/types";
import { useToday } from "@/lib/hooks/use-today";
import { useWeather } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today · AaditOS" },
      { name: "description", content: "What is due, what is next, and what happens today." },
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

/**
 * The one thing to do next.
 *
 * Ranked from the real signals — how soon it is due, how long it takes, and
 * how much uninterrupted time is actually left before the next commitment —
 * and it shows the reason, so it can be argued with rather than obeyed.
 */
function NextUp() {
  const { next, nextWindowMin } = useToday();
  const { toggleTask } = useOS();

  if (!next) {
    return (
      <Panel className="rise">
        <div className="flex items-center gap-3 px-4 py-5">
          <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          <div className="min-w-0">
            <p className="text-[14px] font-medium">Nothing waiting on you</p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Everything open is either done or has no deadline. Add something below.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="rise border-primary/25 bg-primary-soft/25">
      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-primary">
            Next up
          </span>
          {nextWindowMin > 0 ? (
            <Pill tone={next.fitsAvailableTime ? "success" : "warning"}>
              {next.fitsAvailableTime
                ? `Fits your next ${formatDuration(nextWindowMin)}`
                : `Longer than your next ${formatDuration(nextWindowMin)}`}
            </Pill>
          ) : null}
        </div>

        <h2 className="mt-1.5 text-[17px] font-semibold leading-snug tracking-tight">
          {next.task.title}
        </h2>

        <ul className="mt-2 space-y-0.5">
          {next.reasons.slice(0, 2).map((reason) => (
            <li key={reason} className="text-[12.5px] text-muted-foreground">
              · {reason}
            </li>
          ))}
        </ul>

        <div className="mt-3.5 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-8 text-[12.5px]"
            onClick={() => void toggleTask(next.task.id)}
          >
            Mark done
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" asChild>
            <Link to="/ask">
              Ask about it <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** Everything due today or overdue, plus anything undated that is open. */
function DueList() {
  const { mustDoToday, overdue, ranked } = useToday();
  const { status } = useOS();

  if (status === "loading") {
    return (
      <Panel>
        <PanelHeader title="Due today" />
        <RowSkeleton rows={3} />
      </Panel>
    );
  }

  const dueIds = new Set(mustDoToday.map((t) => t.id));
  const undated: Task[] = ranked
    .map((r) => r.task)
    .filter((t) => !t.dueAt && !dueIds.has(t.id))
    .slice(0, 6);

  return (
    <Panel>
      <PanelHeader
        title="Due today"
        meta={
          mustDoToday.length === 0
            ? "nothing"
            : `${mustDoToday.length} open${overdue.length ? ` · ${overdue.length} overdue` : ""}`
        }
      />
      {mustDoToday.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing is due today"
          description="Anything with a deadline today shows up here on its own."
        />
      ) : (
        <div className="divide-y divide-border">
          {mustDoToday.map((task, i) => (
            <TaskRow key={task.id} task={task} index={i} />
          ))}
        </div>
      )}

      {undated.length > 0 ? (
        <>
          <p className="border-t border-border px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            No deadline
          </p>
          <div className="divide-y divide-border">
            {undated.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        </>
      ) : null}
    </Panel>
  );
}

/** Today, as a list. A time grid looked impressive and was unreadable on a phone. */
function Schedule() {
  const { timeline, now, school } = useToday();

  return (
    <Panel>
      <PanelHeader title="Today" meta={school.reason} />
      {timeline.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nothing scheduled"
          description="Classes, school events and anything you capture with a time land here."
        />
      ) : (
        <ol className="divide-y divide-border">
          {timeline.map((event) => {
            const start = new Date(event.startAt);
            const end = event.endAt ? new Date(event.endAt) : null;
            const past = (end ?? start).getTime() < now.getTime();
            const current =
              start.getTime() <= now.getTime() && end !== null && end.getTime() > now.getTime();
            return (
              <li
                key={event.id}
                className={cn(
                  "grid grid-cols-[64px_minmax(0,1fr)] items-baseline gap-3 px-4 py-2.5",
                  past && !current && "opacity-50",
                  current && "bg-primary-soft/30",
                )}
              >
                <span className="text-[11.5px] tabular-nums text-muted-foreground">
                  {event.allDay ? "All day" : formatTime(event.startAt)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px]">
                    {event.title}
                    {current ? (
                      <span className="ml-2 text-[11px] font-medium text-primary">now</span>
                    ) : null}
                  </p>
                  {event.location ? (
                    <p className="truncate text-[11.5px] text-muted-foreground">{event.location}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/** The next seven days, so nothing arrives as a surprise on Thursday night. */
function ComingUp() {
  const { upcoming, now } = useToday();
  if (upcoming.length === 0) return null;
  return (
    <Panel>
      <PanelHeader title="Coming up" meta="next 7 days" />
      <ul className="divide-y divide-border">
        {upcoming.slice(0, 6).map((task) => (
          <li key={task.id} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="w-[64px] shrink-0 text-[11.5px] text-muted-foreground">
              {relativeDayLabel(task.dueAt!, now)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Recent thoughts and ideas, so they are not out of sight the moment they are written. */
function RecentNotes() {
  const { workspace } = useOS();
  const notes = workspace.notes.slice(0, 3);
  if (notes.length === 0) return null;
  const courseName = new Map(workspace.courses.map((c) => [c.id, c.name]));

  return (
    <Panel>
      <PanelHeader
        title="On your mind"
        action={
          <Link
            to="/classes"
            className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            All classes →
          </Link>
        }
      />
      <ul className="divide-y divide-border">
        {notes.map((note) => (
          <li key={note.id} className="flex items-start gap-2.5 px-4 py-2.5">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="break-words text-[12.5px]">{note.body}</p>
              {note.courseId ? (
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {courseName.get(note.courseId)}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TodayPage() {
  const { now, school, mustDoToday, availableMin, doneToday } = useToday();
  const { profile } = useOS();
  const weather = useWeather();

  const summary = [
    school.reason,
    mustDoToday.length === 0 ? "nothing due" : `${mustDoToday.length} due today`,
    doneToday > 0 ? `${doneToday} done` : "",
    availableMin > 0 ? `${formatDuration(availableMin)} free` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">
            {greeting(now)}, {profile.name.split(" ")[0] || "Aadit"}.
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{summary}</p>
        </div>
        {weather.data?.ok ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <WeatherGlyph
              code={weather.data.code ?? 0}
              isDay={weather.data.isDay ?? true}
              className="size-4"
            />
            <span className="tabular-nums">{Math.round(weather.data.tempF ?? 0)}°</span>
          </div>
        ) : null}
      </div>

      <CaptureBar />
      <NextUp />
      <DueList />

      {/*
        min-w-0 on both columns, not decoration. A grid item defaults to
        min-width:auto, so it refuses to shrink below its own min-content — and
        one long note title then widens the column past the viewport and makes
        the whole page scroll sideways on a phone.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <Schedule />
        </div>
        <div className="min-w-0 space-y-4">
          <ComingUp />
          <RecentNotes />
        </div>
      </div>
    </div>
  );
}

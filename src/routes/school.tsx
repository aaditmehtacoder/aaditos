import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  ProgressBar,
  RowSkeleton,
  SectionLabel,
  Segmented,
  SourceTag,
  Stat,
} from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { dedupeEvents } from "@/lib/core/normalize";
import {
  DEFAULT_BELL_SCHEDULE,
  SCHOOL_YEAR,
  formatMin,
  formatSchoolDate,
} from "@/lib/core/schedule";
import {
  addDays,
  dateKey,
  dayDiff,
  formatDateMedium,
  formatDuration,
  formatTime,
  relativeDayLabel,
} from "@/lib/core/time";
import { ASSIGNMENT_STATES, type Assignment, type AssignmentState } from "@/lib/core/types";
import { useToday } from "@/lib/hooks/use-today";
import { useSync } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";

type Tab = "overview" | "assignments" | "classes" | "calendar" | "grades" | "plan";

export const Route = createFileRoute("/school")({
  head: () => ({
    meta: [
      { title: "School · AaditOS" },
      { name: "description", content: "Classes, assignments, calendars and the four-year plan." },
    ],
  }),
  component: SchoolPage,
});

const STATE_LABEL: Record<AssignmentState, string> = {
  assigned: "Upcoming",
  due_soon: "Due soon",
  missing: "Missing",
  submitted: "Submitted",
  graded: "Graded",
};

const STATE_TONE: Record<
  AssignmentState,
  "neutral" | "warning" | "urgent" | "primary" | "success"
> = {
  assigned: "neutral",
  due_soon: "warning",
  missing: "urgent",
  submitted: "primary",
  graded: "success",
};

const FOUR_YEAR_PLAN = [
  {
    year: "Grade 9 · 2026–27",
    current: true,
    courses: ["Algebra 2", "English 9 Honors", "Biology", "Spanish 1", "PE", "Advisory"],
    focus: "Build the GPA base, join STEM and ASB, ship two public projects.",
  },
  {
    year: "Grade 10 · 2027–28",
    current: false,
    courses: ["Precalculus", "English 10 Honors", "Chemistry Honors", "Spanish 2", "AP CSP"],
    focus: "First AP, hackathon leadership, first paid internship.",
  },
  {
    year: "Grade 11 · 2028–29",
    current: false,
    courses: ["AP Calculus BC", "AP English Language", "AP Physics 1", "Spanish 3", "AP CS A"],
    focus: "SAT, research or startup track, national competitions.",
  },
  {
    year: "Grade 12 · 2029–30",
    current: false,
    courses: [
      "Multivariable Calculus",
      "AP English Literature",
      "AP Physics C",
      "AP Statistics",
      "Capstone",
    ],
    focus: "College applications, capstone shipping, mentorship.",
  },
];

function Overview() {
  const { workspace, now } = useOS();
  const { school, nextClass, timeline } = useToday();

  const dueSoon = workspace.assignments.filter(
    (a) =>
      a.dueAt &&
      dayDiff(now, a.dueAt) >= 0 &&
      dayDiff(now, a.dueAt) <= 3 &&
      a.state !== "submitted" &&
      a.state !== "graded",
  );
  const missing = workspace.assignments.filter((a) => a.state === "missing");
  const graded = workspace.assignments.filter((a) => a.state === "graded");
  const workMin = dueSoon.reduce((sum, a) => sum + a.estimateMin, 0);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          <Stat
            label="Due in 3 days"
            value={String(dueSoon.length)}
            hint={formatDuration(workMin)}
          />
          <Stat
            label="Missing"
            value={String(missing.length)}
            hint={missing.length ? "Turn in first" : "All clear"}
          />
          <Stat label="Graded" value={String(graded.length)} hint="This term" />
          <Stat
            label="Courses"
            value={String(workspace.courses.filter((c) => c.active).length)}
            hint={SCHOOL_YEAR.label}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="School day" meta={school.reason} />
          <div className="px-4 py-3 text-[12.5px]">
            {nextClass ? (
              <p>
                Next class: <span className="font-medium">{nextClass.course.name}</span> ·{" "}
                {formatMin(nextClass.slot.startMin)} · {nextClass.course.room}
              </p>
            ) : (
              <p className="text-muted-foreground">No more classes today.</p>
            )}
            <p className="mt-2 text-muted-foreground">
              First day of the {SCHOOL_YEAR.label} year: {formatSchoolDate(SCHOOL_YEAR.firstDay)} ·
              last day {formatSchoolDate(SCHOOL_YEAR.lastDay)}.
            </p>
          </div>
          <div className="border-t border-border">
            <SectionLabel>Bell schedule</SectionLabel>
            <ul className="divide-y divide-border">
              {DEFAULT_BELL_SCHEDULE.map((slot) => {
                const course = workspace.courses.find((c) => c.active && c.period === slot.period);
                return (
                  <li
                    key={`${slot.period}-${slot.label}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-2"
                  >
                    <span className="truncate text-[12.5px]">{course?.name ?? slot.label}</span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {formatMin(slot.startMin)} – {formatMin(slot.endMin)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="px-4 pb-3 pt-2 text-[11.5px] text-muted-foreground">
              Santa Clara USD does not publish a machine-readable bell schedule. These are local
              defaults — edit them in Settings if your periods differ.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Today at school" meta={`${timeline.length} items`} />
          {timeline.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="Sync the Wilcox calendars from Integrations to fill this in."
            />
          ) : (
            <ul className="divide-y divide-border">
              {timeline.slice(0, 9).map((event) => (
                <li key={event.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 px-4 py-2">
                  <span className="text-[11.5px] tabular-nums text-muted-foreground">
                    {event.allDay ? "All day" : formatTime(event.startAt)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px]">{event.title}</p>
                    {event.location ? (
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {event.location}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Assignments() {
  const { workspace, now, status } = useOS();
  const [state, setState] = useState<string>("open");
  const [course, setCourse] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"due" | "course" | "estimate">("due");

  const courseName = useMemo(
    () => new Map(workspace.courses.map((c) => [c.id, c.name])),
    [workspace.courses],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { open: 0 };
    for (const a of workspace.assignments) {
      map[a.state] = (map[a.state] ?? 0) + 1;
      if (a.state !== "submitted" && a.state !== "graded") map["open"] = (map["open"] ?? 0) + 1;
    }
    return map;
  }, [workspace.assignments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = workspace.assignments.filter((a) => {
      if (state === "open") {
        if (a.state === "submitted" || a.state === "graded") return false;
      } else if (state !== "all" && a.state !== state) return false;
      if (course !== "all" && a.courseId !== course) return false;
      if (source !== "all" && a.source !== source) return false;
      if (q && !a.title.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "course") {
        return (courseName.get(a.courseId ?? "") ?? "").localeCompare(
          courseName.get(b.courseId ?? "") ?? "",
        );
      }
      if (sort === "estimate") return a.estimateMin - b.estimateMin;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });
    return list;
  }, [workspace.assignments, state, course, source, query, sort, courseName]);

  const sources = Array.from(new Set(workspace.assignments.map((a) => a.source)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Assignment state"
          value={state}
          onChange={setState}
          options={[
            { value: "open", label: "Open", count: counts["open"] ?? 0 },
            ...ASSIGNMENT_STATES.map((s) => ({
              value: s,
              label: STATE_LABEL[s],
              count: counts[s] ?? 0,
            })),
            { value: "all", label: "All", count: workspace.assignments.length },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assignments"
            aria-label="Search assignments"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>
        <Select value={course} onValueChange={setCourse}>
          <SelectTrigger
            className="h-8 w-auto min-w-[150px] text-[12.5px]"
            aria-label="Course filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {workspace.courses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger
            className="h-8 w-auto min-w-[130px] text-[12.5px]"
            aria-label="Source filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any source</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger
            className="h-8 w-auto min-w-[150px] text-[12.5px]"
            aria-label="Sort assignments"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="due">Sort: due date</SelectItem>
            <SelectItem value="course">Sort: course</SelectItem>
            <SelectItem value="estimate">Sort: shortest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Panel>
        <PanelHeader
          title={`${filtered.length} assignment${filtered.length === 1 ? "" : "s"}`}
          meta={`${formatDuration(filtered.reduce((s, a) => s + a.estimateMin, 0))} of estimated work`}
        />
        {status === "loading" ? (
          <RowSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No assignments match"
            description="Connect Google Classroom in Integrations to import coursework automatically."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <caption className="sr-only">
                Assignments with course, due date, estimated time, state and grade
              </caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th
                    scope="col"
                    className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Assignment
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Course
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Due
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Work
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    State
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Grade
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((assignment) => (
                  <AssignmentRow
                    key={assignment.id}
                    assignment={assignment}
                    courseName={courseName.get(assignment.courseId ?? "") ?? "—"}
                    now={now}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AssignmentRow({
  assignment,
  courseName,
  now,
}: {
  assignment: Assignment;
  courseName: string;
  now: Date;
}) {
  const overdue =
    assignment.dueAt &&
    new Date(assignment.dueAt).getTime() < now.getTime() &&
    assignment.state !== "submitted" &&
    assignment.state !== "graded";

  return (
    <tr className="transition-colors duration-150 hover:bg-muted/50">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px]">{assignment.title}</span>
          {assignment.externalUrl ? (
            <a
              href={assignment.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Open ${assignment.title} externally`}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
        <SourceTag source={assignment.source} className="mt-1" />
      </td>
      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{courseName}</td>
      <td className="px-4 py-2.5 text-[12px]">
        {assignment.dueAt ? (
          <span className={overdue ? "font-medium text-urgent" : "text-muted-foreground"}>
            {relativeDayLabel(assignment.dueAt, now)}
            {assignment.dueAllDay ? "" : ` · ${formatTime(assignment.dueAt)}`}
          </span>
        ) : (
          <span className="text-muted-foreground">No date</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-[12px] tabular-nums text-muted-foreground">
        {formatDuration(assignment.estimateMin)}
      </td>
      <td className="px-4 py-2.5">
        <Pill tone={STATE_TONE[assignment.state]}>{STATE_LABEL[assignment.state]}</Pill>
      </td>
      <td className="px-4 py-2.5 text-[12px] tabular-nums">{assignment.grade ?? "—"}</td>
    </tr>
  );
}

function Classes() {
  const { workspace } = useOS();
  if (workspace.courses.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No courses yet"
          description="Connect Google Classroom or add courses manually to build your schedule."
        />
      </Panel>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {workspace.courses.map((course) => {
        const assignments = workspace.assignments.filter((a) => a.courseId === course.id);
        const open = assignments.filter((a) => a.state !== "submitted" && a.state !== "graded");
        const slot = DEFAULT_BELL_SCHEDULE.find((s) => s.period === course.period);
        return (
          <Panel key={course.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-semibold tracking-tight">{course.name}</h3>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {course.teacher} · {course.room}
                </p>
              </div>
              <span
                aria-hidden
                className="mt-1 size-2 shrink-0 rounded-full"
                style={{ background: course.color }}
              />
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {slot
                ? `${slot.label} · ${formatMin(slot.startMin)}–${formatMin(slot.endMin)}`
                : "Unscheduled"}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Pill tone={open.length > 0 ? "warning" : "success"}>{open.length} open</Pill>
              <Pill tone="neutral">{assignments.length} total</Pill>
              {course.grade ? <Pill tone="primary">{course.grade}</Pill> : null}
            </div>
            {open[0] ? (
              <p className="mt-3 border-t border-border pt-2.5 text-[12px]">
                Next: <span className="font-medium">{open[0].title}</span>
                {open[0].dueAt ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {relativeDayLabel(open[0].dueAt)}
                  </span>
                ) : null}
              </p>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}

function CalendarView() {
  const { workspace, now, isDemo } = useOS();
  const { sync, running } = useSync();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  const sources = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of workspace.events) {
      map.set(event.calendarId, (map.get(event.calendarId) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([id, count]) => ({ id, count }));
  }, [workspace.events]);

  const isOn = (id: string) => enabled[id] !== false;

  const { visible, duplicatesRemoved } = useMemo(() => {
    const filtered = workspace.events.filter((e) => isOn(e.calendarId));
    const result = dedupeEvents(filtered);
    const horizon = addDays(now, 45).getTime();
    return {
      visible: result.events.filter((e) => {
        const t = new Date(e.startAt).getTime();
        return t >= addDays(now, -1).getTime() && t <= horizon;
      }),
      duplicatesRemoved: result.duplicates.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.events, enabled, now]);

  const byDay = useMemo(() => {
    const groups = new Map<string, typeof visible>();
    for (const event of visible) {
      const key = dateKey(event.startAt);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  }, [visible]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <Panel>
        <PanelHeader
          title="Calendar"
          meta={`${visible.length} events${duplicatesRemoved ? ` · ${duplicatesRemoved} duplicates merged` : ""}`}
        />
        {byDay.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No events in range"
            description={
              isDemo
                ? "Demo mode seeds a few events. Sync the Wilcox calendars to pull the real school year."
                : "Sync the Wilcox calendars to import school, district, athletics and counseling events."
            }
            action={
              <Button
                size="sm"
                className="h-8 gap-1.5 text-[12.5px]"
                disabled={running}
                onClick={() => void sync(["wilcox"])}
              >
                <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
                Sync Wilcox calendars
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-border">
            {byDay.map(([day, events]) => (
              <li key={day} className="px-4 py-3">
                <p className="mb-1.5 flex items-center gap-2 text-[12px] font-medium">
                  {relativeDayLabel(events[0]!.startAt, now)}
                  <span className="text-[11.5px] font-normal text-muted-foreground">
                    {formatDateMedium(events[0]!.startAt)}
                  </span>
                </p>
                <ul className="space-y-1">
                  {events.map((event) => (
                    <li key={event.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                      <span className="text-[11.5px] tabular-nums text-muted-foreground">
                        {event.allDay ? "All day" : formatTime(event.startAt)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px]">{event.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {event.location ? (
                            <span className="truncate">{event.location}</span>
                          ) : null}
                          <SourceTag source={event.source} />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel className="h-fit">
        <PanelHeader title="Sources" meta={`${sources.length}`} />
        {sources.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted-foreground">No calendars imported yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sources.map((source) => (
              <li key={source.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <label
                  htmlFor={`cal-${source.id}`}
                  className="min-w-0 flex-1 cursor-pointer text-[12.5px]"
                >
                  <span className="block truncate">{source.id}</span>
                  <span className="text-[11px] text-muted-foreground">{source.count} events</span>
                </label>
                <Switch
                  id={`cal-${source.id}`}
                  checked={isOn(source.id)}
                  onCheckedChange={(checked) =>
                    setEnabled((prev) => ({ ...prev, [source.id]: checked }))
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border p-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full gap-1.5 text-[12.5px]"
            disabled={running}
            onClick={() => void sync(["wilcox"])}
          >
            <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
            Sync now
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Duplicate events across feeds are merged automatically, keeping the most detailed copy.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Grades() {
  const { workspace } = useOS();
  const graded = workspace.assignments.filter((a) => a.state === "graded");

  const byCourse = workspace.courses.map((course) => {
    const items = graded.filter((a) => a.courseId === course.id);
    const earned = items.reduce((sum, a) => sum + parseScore(a.grade).earned, 0);
    const possible = items.reduce((sum, a) => sum + parseScore(a.grade).possible, 0);
    return {
      course,
      items,
      earned,
      possible,
      pct: possible > 0 ? (earned / possible) * 100 : null,
    };
  });

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Grades"
          meta={graded.length === 0 ? "Nothing graded yet" : `${graded.length} graded items`}
        />
        {graded.length === 0 ? (
          <EmptyState
            title="No grades yet"
            description="Grades appear as assignments are graded. AaditOS never estimates a grade you have not received."
          />
        ) : (
          <ul className="divide-y divide-border">
            {byCourse.map(({ course, items, earned, possible, pct }) => (
              <li key={course.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] font-medium">{course.name}</span>
                  <span className="shrink-0 text-[12.5px] tabular-nums">
                    {pct === null ? "—" : `${pct.toFixed(1)}%`}
                  </span>
                </div>
                {pct !== null ? (
                  <div className="mt-2">
                    <ProgressBar
                      value={pct}
                      label={`${course.name} grade`}
                      tone={pct >= 90 ? "success" : pct >= 80 ? "primary" : "warning"}
                    />
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      {earned} of {possible} points across {items.length} graded item
                      {items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    No graded work in this course yet.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="text-[11.5px] text-muted-foreground">
        These percentages are computed only from graded items imported into AaditOS. They are not
        your official gradebook — check Aeries or Google Classroom for that.
      </p>
    </div>
  );
}

function parseScore(grade?: string): { earned: number; possible: number } {
  if (!grade) return { earned: 0, possible: 0 };
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(grade.trim());
  if (fraction) return { earned: Number(fraction[1]), possible: Number(fraction[2]) };
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(grade.trim());
  if (percent) return { earned: Number(percent[1]), possible: 100 };
  return { earned: 0, possible: 0 };
}

function FourYearPlan() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {FOUR_YEAR_PLAN.map((year) => (
        <Panel key={year.year} className="p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold tracking-tight">{year.year}</h3>
            {year.current ? <Pill tone="primary">Current</Pill> : null}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {year.courses.map((course) => (
              <li key={course}>
                <Pill tone="neutral">{course}</Pill>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border pt-2.5 text-[12.5px] text-muted-foreground">
            {year.focus}
          </p>
        </Panel>
      ))}
    </div>
  );
}

function SchoolPage() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="pb-4">
        <h1 className="display text-[23px]">School</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Wilcox High School · {SCHOOL_YEAR.label}
        </p>
      </div>

      <div className="pb-4">
        <Segmented
          label="School section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "assignments", label: "Assignments" },
            { value: "classes", label: "Classes" },
            { value: "calendar", label: "Calendar" },
            { value: "grades", label: "Grades" },
            { value: "plan", label: "Four-year plan" },
          ]}
        />
      </div>

      {tab === "overview" ? <Overview /> : null}
      {tab === "assignments" ? <Assignments /> : null}
      {tab === "classes" ? <Classes /> : null}
      {tab === "calendar" ? <CalendarView /> : null}
      {tab === "grades" ? <Grades /> : null}
      {tab === "plan" ? <FourYearPlan /> : null}
    </div>
  );
}

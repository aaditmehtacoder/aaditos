import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Lightbulb } from "lucide-react";

import { BlockSkeleton, EmptyState, Panel, Pill } from "@/components/os/primitives";
import { bellScheduleFor, formatMin, nextClassFor, schoolDayStatus } from "@/lib/core/schedule";
import { dayDiff } from "@/lib/core/time";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/classes/")({
  head: () => ({
    meta: [
      { title: "Classes · AaditOS" },
      { name: "description", content: "Every class, what is due in it, and what you thought." },
    ],
  }),
  component: ClassesPage,
});

/**
 * Every class as a card, in period order.
 *
 * Each one shows the two numbers that decide whether you need to open it —
 * how much is due, and how many thoughts and ideas are sitting in it — and
 * nothing else. Grades and bell times used to be here too; neither changed
 * what anyone did next.
 */
function ClassesPage() {
  const { workspace, now, status } = useOS();
  const courses = [...workspace.courses]
    .filter((c) => c.active)
    .sort((a, b) => (a.period ?? 99) - (b.period ?? 99));

  const school = schoolDayStatus(now, workspace.events);
  const next = school.isSchoolDay ? nextClassFor(workspace.courses, now) : null;
  const schedule = bellScheduleFor(now);

  const openByCourse = new Map<string, number>();
  for (const task of workspace.tasks) {
    if (task.status === "done" || task.status === "archived" || task.deletedAt) continue;
    if (!task.courseId) continue;
    openByCourse.set(task.courseId, (openByCourse.get(task.courseId) ?? 0) + 1);
  }
  for (const assignment of workspace.assignments) {
    if (!assignment.courseId) continue;
    if (assignment.state === "submitted" || assignment.state === "graded") continue;
    if (assignment.dueAt && dayDiff(now, assignment.dueAt) < 0) continue;
    openByCourse.set(assignment.courseId, (openByCourse.get(assignment.courseId) ?? 0) + 1);
  }

  const notesByCourse = new Map<string, number>();
  for (const note of workspace.notes) {
    if (!note.courseId) continue;
    notesByCourse.set(note.courseId, (notesByCourse.get(note.courseId) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Classes</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {next ? `Next: ${next.course.name} at ${formatMin(next.slot.startMin)}` : school.reason}
        </p>
      </div>

      {/*
        A skeleton while loading, not the empty state. "No classes yet — press
        Sync" is a factual claim, and rendering it during every cold load told
        the user their schedule was missing a second before it appeared.
      */}
      {status === "loading" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <BlockSkeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <Panel>
          <EmptyState
            icon={BookOpen}
            title="No classes yet"
            description="Your schedule appears here once it syncs. Press Sync in the top bar."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {courses.map((course) => {
            const open = openByCourse.get(course.id) ?? 0;
            const noteCount = notesByCourse.get(course.id) ?? 0;
            const slot = schedule.find((s) => s.period === course.period);
            const isNext = next?.course.id === course.id;

            return (
              <Link
                key={course.id}
                to="/classes/$courseId"
                params={{ courseId: course.id }}
                className={cn(
                  "group block rounded-[14px] border border-border bg-card px-4 py-3.5 transition-colors duration-150 hover:border-foreground/20",
                  isNext && "border-primary/40 bg-primary-soft/25",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{course.name}</p>
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {[course.teacher, course.room].filter(Boolean).join(" · ") || "No room set"}
                    </p>
                  </div>
                  {slot ? (
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {formatMin(slot.startMin)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {open > 0 ? (
                    <Pill tone="warning">{open} to do</Pill>
                  ) : (
                    <Pill tone="success">Nothing due</Pill>
                  )}
                  {noteCount > 0 ? (
                    <Pill tone="neutral">
                      <Lightbulb className="size-3" aria-hidden />
                      {noteCount}
                    </Pill>
                  ) : null}
                  {isNext ? <Pill tone="primary">Next</Pill> : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

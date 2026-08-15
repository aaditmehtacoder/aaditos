/**
 * The day planner.
 *
 * A real time grid for today: classes and events sit where they actually are,
 * open gaps invite work into them, and a live now-line moves down the page.
 * Scheduling a task writes `startAt` and nothing else — due dates are never
 * touched, and "Plan my day" always previews before it writes.
 */

import { Link } from "@tanstack/react-router";
import { CalendarPlus, Check, Sparkles, Wand2, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Panel, PanelHeader, Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { autoPlanDay, buildPlannerModel, minutesToLabel } from "@/lib/core/planner";
import type { PlannerBlock, PlannerGap } from "@/lib/core/planner";
import { rankTasks } from "@/lib/core/priority";
import { classEventsForDay, schoolDayStatus } from "@/lib/core/schedule";
import {
  APP_TZ,
  dateKey,
  formatDuration,
  minutesIntoDay,
  zonedParts,
  zonedToUtc,
} from "@/lib/core/time";
import type { Task } from "@/lib/core/types";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Vertical density. 1.05px per minute puts an hour at ~63px — comparable to a
 * calendar app, and enough that a 15-minute block still fits its title without
 * being clamped into its neighbour.
 */
const PX_PER_MIN = 1.05;
const GUTTER = 62;

const KIND_STYLE: Record<PlannerBlock["kind"], string> = {
  class: "border-l-primary/45 bg-primary-soft/45",
  event: "border-l-chart-5 bg-secondary",
  task: "border-l-chart-2 bg-success-soft/55",
  focus: "border-l-success bg-success-soft/60",
};

function minToOffset(minute: number, startMin: number): number {
  return (minute - startMin) * PX_PER_MIN;
}

export function DayPlanner() {
  const { workspace, now, updateTask } = useOS();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<ReturnType<typeof autoPlanDay> | null>(null);
  const [applying, setApplying] = useState(false);

  const school = useMemo(() => schoolDayStatus(now, workspace.events), [now, workspace.events]);

  const model = useMemo(
    () =>
      buildPlannerModel({
        now,
        events: workspace.events,
        classes: school.isSchoolDay
          ? classEventsForDay(workspace.courses, now, workspace.profile.id)
          : [],
        tasks: workspace.tasks,
        workdayStart: workspace.preferences.workdayStart,
        workdayEnd: workspace.preferences.workdayEnd,
      }),
    [now, workspace, school.isSchoolDay],
  );

  const nowMin = minutesIntoDay(now);
  const nowVisible = nowMin >= model.bounds.startMin && nowMin <= model.bounds.endMin;
  const height = (model.bounds.endMin - model.bounds.startMin) * PX_PER_MIN;

  // Open on the current hour rather than at 7am.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !nowVisible) return;
    el.scrollTop = Math.max(0, minToOffset(nowMin, model.bounds.startMin) - el.clientHeight / 3);
    // Only on mount: re-scrolling every minute would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hours = useMemo(() => {
    const out: number[] = [];
    const first = Math.ceil(model.bounds.startMin / 60) * 60;
    for (let m = first; m <= model.bounds.endMin; m += 60) out.push(m);
    return out;
  }, [model.bounds.startMin, model.bounds.endMin]);

  function toInstant(minute: number): string {
    const p = zonedParts(now, APP_TZ);
    return zonedToUtc(
      p.year,
      p.month,
      p.day,
      Math.floor(minute / 60),
      Math.round(minute % 60),
      APP_TZ,
    ).toISOString();
  }

  async function schedule(task: Task, startMin: number) {
    await updateTask(task.id, { startAt: toInstant(startMin) });
    toast.success("Scheduled", {
      description: `${task.title} at ${minutesToLabel(startMin)}`,
    });
  }

  async function unschedule(taskId: string, title: string) {
    await updateTask(taskId, { startAt: undefined });
    toast("Removed from the plan", { description: title });
  }

  function buildPlan() {
    const result = autoPlanDay({
      now,
      model,
      tasks: workspace.tasks,
      schoolDay: school.isSchoolDay,
    });
    if (result.placements.length === 0) {
      toast.message("Nothing to schedule", {
        description:
          result.skipped[0]?.reason ?? "Every open task is already on the plan or does not fit.",
      });
      return;
    }
    setPreview(result);
  }

  async function applyPlan() {
    if (!preview) return;
    setApplying(true);
    for (const placement of preview.placements) {
      await updateTask(placement.taskId, { startAt: toInstant(placement.startMin) });
    }
    setApplying(false);
    setPreview(null);
    toast.success(`Planned ${preview.placements.length} tasks`, {
      description: `${formatDuration(preview.plannedMin)} of focused work today.`,
    });
  }

  const scheduledTaskCount = model.blocks.filter((b) => b.kind === "task").length;

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <PanelHeader
        title="Plan"
        meta={
          model.remainingFreeMin > 0
            ? `${formatDuration(model.remainingFreeMin)} left · ${scheduledTaskCount} planned`
            : `${scheduledTaskCount} planned`
        }
        action={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[12px]"
            onClick={buildPlan}
            disabled={model.remainingFreeMin < 10}
            title={
              model.remainingFreeMin < 10
                ? "No open time left today"
                : "Fill open time with ranked work"
            }
          >
            <Wand2 className="size-3.5" aria-hidden />
            Plan my day
          </Button>
        }
      />

      {preview ? (
        <div className="fade border-b border-border bg-primary-soft/30 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
            <Sparkles className="size-3" aria-hidden /> Proposed plan
          </p>
          <ol className="mt-2 space-y-1">
            {preview.placements.map((placement, i) => (
              <li
                key={placement.taskId}
                style={{ "--i": i } as React.CSSProperties}
                className="rise-fast grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-[12px]"
              >
                <span className="tabular-nums text-muted-foreground">
                  {minutesToLabel(placement.startMin)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{placement.title}</span>
                  <span className="text-[11px] text-muted-foreground">{placement.reason}</span>
                </span>
              </li>
            ))}
          </ol>
          {preview.skipped.length > 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Left out: {preview.skipped.map((s) => s.title).join(", ")}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="h-7 gap-1.5 text-[12px]"
              disabled={applying}
              onClick={() => void applyPlan()}
            >
              <Check className="size-3.5" aria-hidden />
              Add {preview.placements.length} to the plan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-[12px]"
              onClick={() => setPreview(null)}
            >
              <X className="size-3.5" aria-hidden /> Discard
            </Button>
          </div>
        </div>
      ) : null}

      {model.allDay.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
          {model.allDay.map((event) => (
            <Pill key={event.id} tone="neutral">
              {event.title}
            </Pill>
          ))}
        </div>
      ) : null}

      {model.blocks.length === 0 && model.gaps.length === 0 ? (
        <EmptyState
          title="Nothing to plan yet"
          description="Your workday window is empty. Adjust it in Settings, or add a task with a due date."
        />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative px-4 py-3" style={{ height: height + 24 }}>
            {/* Hour rules */}
            {hours.map((minute) => (
              <div
                key={minute}
                className="pointer-events-none absolute inset-x-4 flex items-center gap-2"
                style={{ top: minToOffset(minute, model.bounds.startMin) + 12 }}
              >
                <span className="w-[40px] shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground/70">
                  {minutesToLabel(minute)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ))}

            {/* Open gaps — the invitation to plan */}
            {model.gaps.map((gap) => (
              <GapSlot
                key={`${gap.startMin}-${gap.endMin}`}
                gap={gap}
                bounds={model.bounds}
                nowMin={nowMin}
                onSchedule={schedule}
              />
            ))}

            {/* Blocks */}
            {model.blocks.map((block, i) => {
              const top = minToOffset(block.startMin, model.bounds.startMin) + 12;
              const rawHeight = (block.endMin - block.startMin) * PX_PER_MIN;
              const widthPct = 100 / block.lanes;
              const isPast = block.endMin <= nowMin;
              const isNow = nowMin >= block.startMin && nowMin < block.endMin;

              return (
                <div
                  key={block.id}
                  style={
                    {
                      top,
                      height: Math.max(16, rawHeight - 3),
                      left: `calc(${GUTTER}px + ${block.lane * widthPct}%)`,
                      width: `calc(${widthPct}% - ${GUTTER * (1 / block.lanes)}px - 4px)`,
                      "--i": i,
                    } as React.CSSProperties
                  }
                  className={cn(
                    "rise-fast absolute overflow-hidden rounded-[9px] border-l-[3px] px-2 py-1",
                    "transition-[opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]",
                    KIND_STYLE[block.kind],
                    isPast && "opacity-45",
                    isNow && "ring-1 ring-primary/30",
                  )}
                >
                  {/* On touch the actions are always painted over the top-right
                      corner, so the title reserves room for them. */}
                  <p
                    className={cn(
                      "truncate text-[11px] font-medium leading-tight",
                      block.taskId && "any-pointer-coarse:pr-[62px]",
                    )}
                  >
                    {block.title}
                  </p>
                  {rawHeight > 40 ? (
                    <p className="mt-0.5 truncate text-[10.5px] leading-tight text-muted-foreground">
                      {minutesToLabel(block.startMin)}
                      {block.detail ? ` · ${block.detail}` : ""}
                    </p>
                  ) : null}

                  {/*
                    Same rule as a task row: revealed on hover for a pointer,
                    always there for a finger, and inert while invisible so a
                    tap on the block cannot hit the unschedule button by
                    accident. Only blocks with room to show them get them —
                    inside a 16px sliver they would be clipped and untappable.
                  */}
                  {block.taskId && rawHeight > 28 ? (
                    <div className="pointer-events-none absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] focus-within:pointer-events-auto focus-within:opacity-100 hover:pointer-events-auto hover:opacity-100 any-pointer-coarse:pointer-events-auto any-pointer-coarse:opacity-100 [div:hover>&]:pointer-events-auto [div:hover>&]:opacity-100">
                      <Link
                        to="/focus"
                        search={{ taskId: block.taskId }}
                        className="rounded bg-card/85 px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Focus
                      </Link>
                      <button
                        type="button"
                        aria-label={`Remove ${block.title} from the plan`}
                        onClick={() => void unschedule(block.taskId!, block.title)}
                        className="rounded bg-card/85 p-1 text-muted-foreground hover:text-urgent"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* An empty grid should still say what to do next. */}
            {scheduledTaskCount === 0 && model.largestRemainingGap && !preview ? (
              // On touch every gap labels itself, so this hint would only
              // duplicate one of them — and land on top of it.
              <div
                className="pointer-events-none absolute flex items-center any-pointer-coarse:hidden"
                style={{
                  top:
                    minToOffset(
                      model.largestRemainingGap.startMin +
                        Math.min(60, model.largestRemainingGap.minutes / 2),
                      model.bounds.startMin,
                    ) + 12,
                  left: GUTTER + 8,
                }}
              >
                <p className="fade text-[11.5px] text-muted-foreground/70">
                  {formatDuration(model.largestRemainingGap.minutes)} open — click a slot, or use
                  Plan my day.
                </p>
              </div>
            ) : null}

            {/* Now line */}
            {nowVisible ? (
              <div
                className="pointer-events-none absolute inset-x-4 z-10 flex items-center gap-1.5"
                style={{ top: minToOffset(nowMin, model.bounds.startMin) + 12 }}
                aria-hidden
              >
                <span className="w-[40px] shrink-0 text-right text-[10px] font-medium tabular-nums text-primary">
                  now
                </span>
                <span className="size-1.5 shrink-0 rounded-full bg-primary animate-[now-pulse_2.8s_ease-in-out_infinite]" />
                <span className="h-px flex-1 bg-primary/40" />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}

function GapSlot({
  gap,
  bounds,
  nowMin,
  onSchedule,
}: {
  gap: PlannerGap;
  bounds: { startMin: number; endMin: number };
  nowMin: number;
  onSchedule: (task: Task, startMin: number) => Promise<void>;
}) {
  const { workspace, now } = useOS();
  const [open, setOpen] = useState(false);

  const startMin = Math.max(gap.startMin, Math.min(nowMin, gap.endMin));
  const available = gap.endMin - startMin;
  const past = gap.endMin <= nowMin;

  const candidates = useMemo(() => {
    if (!open) return [];
    const today = dateKey(now);
    const unscheduled = workspace.tasks.filter((t) => !t.startAt || dateKey(t.startAt) !== today);
    return rankTasks(unscheduled, { now, availableMin: available, schoolDay: false })
      .filter((r) => r.task.estimateMin <= available)
      .slice(0, 6);
  }, [open, workspace.tasks, now, available]);

  if (past || available < 10) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Schedule work at ${minutesToLabel(startMin)} — ${formatDuration(available)} free`}
          style={{
            top: (startMin - bounds.startMin) * PX_PER_MIN + 12,
            height: Math.max(18, available * PX_PER_MIN - 3),
            left: GUTTER,
          }}
          className={cn(
            "group/gap absolute right-4 rounded-[9px] border border-dashed border-transparent",
            "transition-[background-color,border-color] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]",
            "hover:border-primary/35 hover:bg-primary-soft/25",
            "focus-visible:border-primary/50 focus-visible:bg-primary-soft/25",
          )}
        >
          {/* On touch there is no hover to reveal this, so the free window
              labels itself — otherwise the slot looks like empty grid. */}
          <span className="flex h-full items-center gap-1.5 px-2 text-[11px] text-muted-foreground opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover/gap:opacity-100 group-focus-visible/gap:opacity-100 any-pointer-coarse:opacity-70">
            <CalendarPlus className="size-3" aria-hidden />
            {formatDuration(available)} free
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <p className="border-b border-border px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          {minutesToLabel(startMin)} · {formatDuration(available)} free
        </p>
        {candidates.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-muted-foreground">
            Nothing unscheduled fits this window.
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto py-1">
            {candidates.map(({ task, reasons }) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void onSchedule(task, startMin);
                  }}
                  className="w-full px-3 py-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-muted"
                >
                  <span className="block truncate text-[12.5px]">{task.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {formatDuration(task.estimateMin)} · {reasons[0] ?? "No deadline"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Native renderers for the assistant's tool results.
 *
 * Answers render as real components — plans, conflict warnings, checklists —
 * rather than as a wall of markdown. Write proposals always render as a
 * confirmation card that does nothing until the user presses Save.
 */

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  Clock,
  Lightbulb,
  Timer,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { formatDuration, formatTime, relativeDayLabel } from "@/lib/core/time";
import type { TaskDraft } from "@/lib/core/nl-task";
import type {
  ConflictReport,
  DailyPlan,
  CompassProposal,
  CompassToolName,
} from "@/lib/compass/types";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

const CATEGORY_BAR: Record<string, string> = {
  school: "bg-chart-1",
  work: "bg-chart-2",
  personal: "bg-chart-3",
  break: "bg-border",
};

export function PlanBlockList({ plan }: { plan: DailyPlan }) {
  return (
    <div className="rounded-[12px] border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <p className="text-[12px] font-medium">{plan.summary}</p>
      </div>
      <ol className="divide-y divide-border">
        {plan.blocks.map((block) => (
          <li
            key={`${block.startAt}-${block.title}`}
            className="grid grid-cols-[76px_auto_minmax(0,1fr)] items-start gap-2.5 px-3 py-2"
          >
            <span className="text-[11.5px] tabular-nums text-muted-foreground">
              {formatTime(block.startAt)}
            </span>
            <span
              aria-hidden
              className={cn(
                "mt-1 h-5 w-[2px] rounded-full",
                CATEGORY_BAR[block.category] ?? "bg-border",
              )}
            />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium">{block.title}</p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {formatDuration(block.minutes)} · {block.reason}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {plan.skipped.length > 0 ? (
        <div className="border-t border-border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Left out</p>
          <ul className="mt-1 space-y-0.5">
            {plan.skipped.map((item) => (
              <li key={item.title} className="text-[11.5px] text-muted-foreground">
                {item.title} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ConflictList({ report }: { report: ConflictReport }) {
  if (report.conflicts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-[12px] border border-success/30 bg-success-soft px-3 py-2.5 text-[12.5px] text-success-strong">
        <Check className="size-3.5 shrink-0" aria-hidden />
        No overlapping events in the next {report.checkedDays} days.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {report.conflicts.map((conflict, i) => (
        <li
          key={`${conflict.startAt}-${i}`}
          className="flex items-start gap-2 rounded-[12px] border border-urgent/30 bg-urgent-soft px-3 py-2.5 text-[12.5px] text-urgent"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">
              {conflict.aTitle} overlaps {conflict.bTitle}
            </span>
            <span className="block text-[11.5px]">
              {relativeDayLabel(conflict.startAt)} at {formatTime(conflict.startAt)} ·{" "}
              {conflict.overlapMin} minutes
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TaskChecklist({
  tasks,
}: {
  tasks: Array<{
    id: string;
    title: string;
    dueAt?: string;
    estimateMin: number;
    priority: string;
  }>;
}) {
  const { toggleTask } = useOS();
  if (tasks.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">No matching tasks.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-[12px] border border-border bg-card">
      {tasks.slice(0, 10).map((task) => (
        <li key={task.id} className="flex items-center gap-2.5 px-3 py-2">
          <button
            type="button"
            aria-label={`Complete ${task.title}`}
            onClick={() => {
              void toggleTask(task.id);
              toast.success("Marked complete", { description: task.title });
            }}
            className="grid size-4 shrink-0 place-items-center rounded border border-border transition-colors duration-150 hover:border-primary hover:bg-primary-soft"
          >
            <Check className="size-3 opacity-0 transition-opacity hover:opacity-60" aria-hidden />
          </button>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px]">{task.title}</span>
            <span className="text-[11.5px] text-muted-foreground">
              {task.dueAt ? relativeDayLabel(task.dueAt) : "No date"} ·{" "}
              {formatDuration(task.estimateMin)} · {task.priority}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AssignmentList({
  assignments,
}: {
  assignments: Array<{ id: string; title: string; course?: string; dueAt?: string; state: string }>;
}) {
  if (assignments.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">No matching assignments.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-[12px] border border-border bg-card">
      {assignments.slice(0, 10).map((a) => (
        <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-[12.5px]">{a.title}</span>
            <span className="text-[11.5px] text-muted-foreground">{a.course ?? "—"}</span>
          </span>
          <span className="shrink-0 text-[11.5px] text-muted-foreground">
            {a.dueAt ? relativeDayLabel(a.dueAt) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EventTimeline({
  events,
}: {
  events: Array<{ id: string; title: string; startAt: string; allDay: boolean; location?: string }>;
}) {
  if (events.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">Nothing on the calendar.</p>;
  }
  return (
    <ol className="divide-y divide-border rounded-[12px] border border-border bg-card">
      {events.slice(0, 12).map((event) => (
        <li key={event.id} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2.5 px-3 py-2">
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {relativeDayLabel(event.startAt)}
            {event.allDay ? "" : ` ${formatTime(event.startAt)}`}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px]">{event.title}</span>
            {event.location ? (
              <span className="block truncate text-[11.5px] text-muted-foreground">
                {event.location}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What a proposed task will look like once saved. Nothing is saved yet. */
export function TaskDraftPreview({ draft }: { draft: TaskDraft }) {
  return (
    <div className="rounded-[12px] border border-border bg-secondary/40 p-3">
      <p className="text-[13.5px] font-medium">{draft.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Pill tone="neutral">{draft.category}</Pill>
        <Pill
          tone={
            draft.priority === "urgent"
              ? "urgent"
              : draft.priority === "high"
                ? "warning"
                : "neutral"
          }
        >
          {draft.priority} priority
        </Pill>
        <Pill tone="neutral">
          <Timer className="size-3" aria-hidden />
          {formatDuration(draft.estimateMin)}
        </Pill>
        <Pill tone="neutral">
          <CalendarClock className="size-3" aria-hidden />
          {draft.dueAt
            ? `${relativeDayLabel(draft.dueAt)}${draft.dueAllDay ? "" : ` · ${formatTime(draft.dueAt)}`}`
            : "No due date"}
        </Pill>
        {draft.courseName ? <Pill tone="neutral">{draft.courseName}</Pill> : null}
      </div>
      {draft.subtasks && draft.subtasks.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {draft.subtasks.map((title) => (
            <li key={title} className="text-[12px] text-muted-foreground">
              · {title}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The user's own notes, quoted back when the assistant used them. */
export function NoteList({
  notes,
}: {
  notes: Array<{ id: string; body: string; kind: string; course?: string | undefined }>;
}) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {notes.slice(0, 6).map((note) => (
        <li
          key={note.id}
          className="flex items-start gap-2 rounded-[12px] border border-border bg-card px-3 py-2"
        >
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-[12.5px]">{note.body}</p>
            {note.course ? (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">{note.course}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProposalCard({ proposal }: { proposal: CompassProposal }) {
  const { createTask, updateTask, workspace } = useOS();
  const [state, setState] = useState<"pending" | "saved" | "dismissed">("pending");
  const [busy, setBusy] = useState(false);

  if (state === "saved") {
    return (
      <div className="flex items-center gap-2 rounded-[12px] border border-success/30 bg-success-soft px-3 py-2 text-[12.5px] text-success-strong">
        <Check className="size-3.5 shrink-0" aria-hidden /> Saved.
      </div>
    );
  }
  if (state === "dismissed") {
    return (
      <div className="flex items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-[12.5px] text-muted-foreground">
        <X className="size-3.5 shrink-0" aria-hidden /> Dismissed — nothing was saved.
      </div>
    );
  }

  async function confirm() {
    setBusy(true);
    try {
      if (proposal.tool === "propose_task" && proposal.draft) {
        const draft = proposal.draft;
        const course = workspace.courses.find((c) => c.name === draft.courseName);
        const created = await createTask({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          courseId: course?.id,
          dueAt: draft.dueAt,
          dueAllDay: draft.dueAllDay,
          priority: draft.priority,
          estimateMin: draft.estimateMin,
          subtasks: draft.subtasks?.map((title) => ({ title })),
          source: "manual",
        });
        if (created) {
          setState("saved");
          toast.success("Task created", { description: created.title });
        }
      } else if (proposal.tool === "update_task" && proposal.update) {
        await updateTask(proposal.update.taskId, proposal.update.patch);
        setState("saved");
        toast.success("Task updated");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-primary/30 bg-primary-soft/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
        <CalendarClock className="size-3" aria-hidden /> Needs your confirmation
      </p>
      <p className="mt-1.5 text-[12.5px]">{proposal.summary}</p>
      {proposal.draft ? (
        <div className="mt-2.5">
          <TaskDraftPreview draft={proposal.draft} />
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          className="h-8 text-[12.5px]"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {proposal.tool === "propose_task" ? "Save task" : "Apply change"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-[12.5px]"
          onClick={() => setState("dismissed")}
        >
          Dismiss
        </Button>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="size-3" aria-hidden /> Nothing is saved until you press this.
      </p>
    </div>
  );
}

export function ToolResultBlock({ name, data }: { name: CompassToolName; data: unknown }) {
  const payload = data as Record<string, unknown>;

  switch (name) {
    case "create_daily_plan":
      return <PlanBlockList plan={payload as unknown as DailyPlan} />;
    case "find_schedule_conflicts":
      return <ConflictList report={payload as unknown as ConflictReport} />;
    case "list_tasks":
      return <TaskChecklist tasks={(payload["tasks"] ?? []) as never} />;
    case "list_assignments":
      return <AssignmentList assignments={(payload["assignments"] ?? []) as never} />;
    case "list_events":
      return <EventTimeline events={(payload["events"] ?? []) as never} />;
    case "list_notes":
      return <NoteList notes={(payload["notes"] ?? []) as never} />;
    default:
      return null;
  }
}

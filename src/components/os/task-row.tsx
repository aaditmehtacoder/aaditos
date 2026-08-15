import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PriorityDot, SourceTag, isExternalSource } from "@/components/os/primitives";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDuration, formatTime, relativeDayLabel } from "@/lib/core/time";
import type { Task } from "@/lib/core/types";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

export function TaskDueLabel({ task, now }: { task: Task; now: Date }) {
  if (!task.dueAt) return <span>No date</span>;
  const overdue = new Date(task.dueAt).getTime() < now.getTime() && task.status !== "done";
  return (
    <span className={cn(overdue && "text-urgent")}>
      {relativeDayLabel(task.dueAt, now)}
      {task.dueAllDay ? "" : ` · ${formatTime(task.dueAt)}`}
      {overdue ? " · overdue" : ""}
    </span>
  );
}

export function TaskRow({
  task,
  showReorder = false,
  onOpen,
  dense = false,
  index,
}: {
  task: Task;
  showReorder?: boolean;
  onOpen?: (task: Task) => void;
  dense?: boolean;
  index?: number;
}) {
  const { toggleTask, moveTask, workspace, now } = useOS();
  const done = task.status === "done";
  const course = workspace.courses.find((c) => c.id === task.courseId);
  const project = workspace.projects.find((p) => p.id === task.projectId);
  const context = course?.name ?? project?.name;

  // Play the settle animation only on a real transition, never on mount.
  const [justChanged, setJustChanged] = useState(false);
  const previousDone = useRef(done);
  useEffect(() => {
    if (previousDone.current !== done) {
      previousDone.current = done;
      setJustChanged(true);
      const id = window.setTimeout(() => setJustChanged(false), 300);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [done]);

  return (
    <div
      style={index === undefined ? undefined : ({ "--i": index } as React.CSSProperties)}
      className={cn(
        "group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out-soft)] hover:bg-muted/40",
        dense ? "py-2.5" : "py-3",
        index !== undefined && "rise-fast",
        justChanged && "settle-once",
      )}
    >
      <Checkbox
        checked={done}
        onCheckedChange={() => void toggleTask(task.id)}
        className="mt-px"
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
      />

      <button
        type="button"
        onClick={() => onOpen?.(task)}
        disabled={!onOpen}
        className={cn("min-w-0 text-left", onOpen ? "cursor-pointer" : "cursor-default")}
      >
        <span
          className={cn(
            "flex min-w-0 items-center gap-2 text-[13px] transition-colors duration-[var(--dur-base)]",
            done && "text-muted-foreground",
          )}
        >
          <PriorityDot priority={task.priority} muted={done} />
          <span
            className={cn(
              "truncate transition-[opacity,text-decoration-color] duration-[var(--dur-base)]",
              done && "line-through decoration-muted-foreground/50",
            )}
          >
            {task.title}
          </span>
        </span>

        <span
          className={cn(
            "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[14px] text-[11.5px] text-muted-foreground transition-opacity duration-[var(--dur-base)]",
            done && "opacity-55",
          )}
        >
          <TaskDueLabel task={task} now={now} />
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span>{formatDuration(task.estimateMin)}</span>
          {context ? (
            <>
              <span aria-hidden className="opacity-40">
                ·
              </span>
              <span className="truncate">{context}</span>
            </>
          ) : null}
          {/* Only genuinely external origins earn a tag; manual and demo do not. */}
          {isExternalSource(task.source) ? <SourceTag source={task.source} /> : null}
        </span>
      </button>

      {/*
        Row actions reveal on hover for a trackpad, but a touchscreen has no
        hover state — on a touch device they stay visible, otherwise they are
        unreachable. While hidden they are also inert, so a tap on the empty
        right half of a row cannot land on an invisible button.
      */}
      <div
        className={cn(
          "flex items-center gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)]",
          "pointer-events-none focus-within:pointer-events-auto group-hover:pointer-events-auto",
          "focus-within:opacity-100 group-hover:opacity-100",
          "any-pointer-coarse:pointer-events-auto any-pointer-coarse:opacity-100",
        )}
      >
        {task.externalUrl ? (
          <a
            href={task.externalUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${task.title} in the source app`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        {showReorder ? (
          <>
            <button
              type="button"
              aria-label={`Move ${task.title} up`}
              onClick={() => void moveTask(task.id, -1)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${task.title} down`}
              onClick={() => void moveTask(task.id, 1)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </>
        ) : null}
        <Link
          to="/focus"
          search={{ taskId: task.id }}
          className="rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Focus
        </Link>
      </div>
    </div>
  );
}

import { ExternalLink, Trash2 } from "lucide-react";
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

/**
 * One task. The whole row is the checkbox's business — tapping the title
 * toggles it too, because on a phone a 16px checkbox is the wrong target and
 * "mark it done" is the only thing anyone wants to do to a task in a list.
 */
export function TaskRow({ task, index }: { task: Task; index?: number }) {
  const { toggleTask, deleteTask, workspace, now } = useOS();
  const done = task.status === "done";
  const course = workspace.courses.find((c) => c.id === task.courseId);

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
        "group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out-soft)] hover:bg-muted/40",
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
        onClick={() => void toggleTask(task.id)}
        className="min-w-0 cursor-pointer text-left"
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
          {course ? (
            <>
              <span aria-hidden className="opacity-40">
                ·
              </span>
              <span className="truncate">{course.name}</span>
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
        <button
          type="button"
          aria-label={`Delete ${task.title}`}
          onClick={() => void deleteTask(task.id)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-urgent-soft hover:text-urgent"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

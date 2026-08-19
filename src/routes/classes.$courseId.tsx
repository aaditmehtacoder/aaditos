import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Check, Lightbulb, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CaptureBar } from "@/components/os/capture-bar";
import { BlockSkeleton, EmptyState, Panel, PanelHeader, Pill } from "@/components/os/primitives";
import { TaskRow } from "@/components/os/task-row";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatMin, bellScheduleFor } from "@/lib/core/schedule";
import { relativeDayLabel, relativeTimeLabel } from "@/lib/core/time";
import { NOTE_KIND_LABELS, type Note, type NoteKind } from "@/lib/core/types";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/classes/$courseId")({
  component: ClassPage,
});

/**
 * Write a thought or an idea about this class.
 *
 * Deliberately not the smart capture box: this one is instant and offline-safe
 * because it does exactly one thing. A thought you have walking out of English
 * should cost one tap and no round trip, and it must not be able to become a
 * task with an invented deadline.
 */
function AddNote({ courseId }: { courseId: string }) {
  const { createNote } = useOS();
  const [kind, setKind] = useState<NoteKind>("thought");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const value = body.trim();
    if (!value || busy) return;
    setBusy(true);
    const saved = await createNote({ courseId, kind, body: value });
    setBusy(false);
    if (saved) {
      setBody("");
      toast.success(`${NOTE_KIND_LABELS[kind]} saved`);
    }
  }

  const kinds: NoteKind[] = ["thought", "idea"];

  return (
    <div className="rounded-[14px] border border-border bg-card p-2 transition-colors focus-within:border-foreground/20">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        rows={2}
        placeholder="What are you thinking about this class?"
        aria-label="Add a thought or idea"
        className="min-h-[52px] resize-none border-0 bg-transparent px-2 py-1.5 text-[13.5px] shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-0.5 pt-1">
        <div
          role="radiogroup"
          aria-label="Kind"
          className="inline-flex items-center gap-0.5 rounded-[9px] bg-secondary p-0.5"
        >
          {kinds.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "rounded-[7px] px-2.5 py-1 text-[12px] transition-colors duration-150",
                kind === option
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {NOTE_KIND_LABELS[option]}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-[12px]"
          disabled={busy || body.trim().length === 0}
          onClick={() => void save()}
        >
          <Plus className="size-3.5" aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}

/**
 * One note, and the one action that matters on it: turning it into a task.
 *
 * `taskId` is set when that happens, so a good idea can be acted on once and
 * cannot quietly become three duplicate todos over a week.
 */
function NoteRow({ note, courseName }: { note: Note; courseName: string }) {
  const { createTask, updateNote, deleteNote, workspace } = useOS();
  const [busy, setBusy] = useState(false);
  const linked = note.taskId ? workspace.tasks.find((t) => t.id === note.taskId) : undefined;

  async function toTask() {
    if (busy) return;
    setBusy(true);
    const task = await createTask({
      title: note.body.length > 90 ? `${note.body.slice(0, 87)}…` : note.body,
      description: `From a ${note.kind} in ${courseName}.`,
      category: "school",
      courseId: note.courseId,
      priority: "normal",
      estimateMin: 30,
      source: "manual",
    });
    if (task) {
      await updateNote(note.id, { taskId: task.id });
      toast.success("Added to your list", { description: task.title });
    }
    setBusy(false);
  }

  return (
    <li className="group flex items-start gap-3 px-4 py-3">
      {note.kind === "idea" ? (
        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      ) : (
        <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-[13px]">{note.body}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          <span>{NOTE_KIND_LABELS[note.kind]}</span>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span>{relativeTimeLabel(note.createdAt)}</span>
          {linked ? (
            <Pill tone={linked.status === "done" ? "success" : "primary"}>
              <Check className="size-3" aria-hidden />
              {linked.status === "done" ? "Done" : "On your list"}
            </Pill>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150",
          "pointer-events-none focus-within:pointer-events-auto group-hover:pointer-events-auto",
          "focus-within:opacity-100 group-hover:opacity-100",
          "any-pointer-coarse:pointer-events-auto any-pointer-coarse:opacity-100",
        )}
      >
        {!linked ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void toTask()}
            className="h-7 px-2 text-[11.5px]"
          >
            Make it a task
          </Button>
        ) : null}
        <button
          type="button"
          aria-label="Delete this note"
          onClick={() => void deleteNote(note.id)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-urgent-soft hover:text-urgent"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function ClassPage() {
  const { courseId } = useParams({ from: "/classes/$courseId" });
  const { workspace, now, status } = useOS();

  const course = workspace.courses.find((c) => c.id === courseId);

  // Same reason as the classes list: "Class not found" is a claim, and it is
  // false for the second before the workspace arrives.
  if (status === "loading") {
    return (
      <div className="space-y-4">
        <BlockSkeleton className="h-4 w-20" />
        <BlockSkeleton className="h-8 w-56" />
        <BlockSkeleton className="h-[84px]" />
        <BlockSkeleton className="h-[180px]" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="space-y-4">
        <Link
          to="/classes"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Classes
        </Link>
        <Panel>
          <EmptyState
            title="Class not found"
            description="It may have been removed by a sync. Go back and pick another."
          />
        </Panel>
      </div>
    );
  }

  const tasks = workspace.tasks
    .filter((t) => t.courseId === course.id && t.status !== "archived" && !t.deletedAt)
    .sort((a, b) => {
      if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });

  const assignments = workspace.assignments
    .filter((a) => a.courseId === course.id && a.state !== "graded" && a.state !== "submitted")
    .sort(
      (a, b) =>
        (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) -
        (b.dueAt ? new Date(b.dueAt).getTime() : Infinity),
    );

  const notes = workspace.notes.filter((n) => n.courseId === course.id);
  const slot = bellScheduleFor(now).find((s) => s.period === course.period);
  const openCount = tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="space-y-4">
      <Link
        to="/classes"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Classes
      </Link>

      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{course.name}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {[
            course.teacher,
            course.room,
            slot ? `${formatMin(slot.startMin)}–${formatMin(slot.endMin)}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* Capture is scoped to this class, so anything typed here lands on it
          without the model having to guess which class was meant. */}
      <CaptureBar
        courseId={course.id}
        placeholder={`Anything for ${course.name} — homework, a date, or what the teacher said`}
      />

      <Panel>
        <PanelHeader title="To do" meta={openCount === 0 ? "nothing open" : `${openCount} open`} />
        {tasks.length === 0 && assignments.length === 0 ? (
          <EmptyState
            title="Nothing for this class"
            description="Type what you need to do in the box above and it lands here."
          />
        ) : (
          <div className="divide-y divide-border">
            {tasks.map((task, i) => (
              <TaskRow key={task.id} task={task} index={i} />
            ))}
            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="flex items-baseline justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px]">{assignment.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {assignment.dueAt ? relativeDayLabel(assignment.dueAt, now) : "No due date"} ·
                    from Classroom
                  </p>
                </div>
                {assignment.state === "missing" ? <Pill tone="urgent">Missing</Pill> : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Thoughts & ideas"
          meta={notes.length === 0 ? "nothing yet" : `${notes.length}`}
        />
        <div className="px-4 pb-3 pt-3">
          <AddNote courseId={course.id} />
        </div>
        {notes.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="Nothing written down yet"
            description="What the teacher actually wants, what you got stuck on, an idea for the next project — none of that is a task, and this is where it goes."
          />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {notes.map((note) => (
              <NoteRow key={note.id} note={note} courseName={course.name} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

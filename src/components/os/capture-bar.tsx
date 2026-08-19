/**
 * One box for everything.
 *
 * Keeping a todo list is hard because the list only accepts todos. What
 * actually needs remembering arrives as "fin lit packet friday", as a club
 * email with four dates buried in it, or as "Robson wants the thesis arguable"
 * — which is not a task at all. Anything that makes you classify before you
 * type is a box you stop using by October.
 *
 * So this box takes whatever you have. The server reads it, works out what
 * each piece is — a task, an event, or a thought about a class — and saves it.
 * Nothing to choose, no form, no dropdowns.
 *
 * It saves rather than proposing on purpose. A confirmation step is the right
 * call for an assistant acting on its own initiative, and the wrong call for
 * something you just typed yourself: you already decided. What replaces it is
 * Undo — the toast puts everything back for a few seconds, which costs nothing
 * when the model gets it right and is exactly as good when it does not.
 */

import { CornerDownLeft, Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { clientId } from "@/lib/compass/client";
import { APP_TZ } from "@/lib/core/time";
import type { NoteKind } from "@/lib/core/types";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

interface CapturedItem {
  kind: "task" | "event" | "note";
  title: string;
  description?: string | null;
  courseName?: string | null;
  location?: string | null;
  dueAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  allDay: boolean;
  category: "school" | "work" | "personal";
  priority: "urgent" | "high" | "normal" | "low";
  estimateMin: number;
  noteKind?: NoteKind | null;
}

export function CaptureBar({
  /** Pre-attach everything captured here to one class. Used on a class page. */
  courseId,
  placeholder = "Type anything — a task, a date, a thought, or paste a whole email",
  className,
}: {
  courseId?: string | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}) {
  const { workspace, createTask, createNote, captureEvent, deleteTask, deleteNote } = useOS();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);

    try {
      const response = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: value,
          courses: workspace.courses.filter((c) => c.active).map((c) => c.name),
          // A note usually names the teacher, not the subject: "Robson wants
          // the thesis arguable" only reaches the English page if the server
          // knows who Robson is.
          teachers: workspace.courses
            .filter((c) => c.active && c.teacher)
            .map((c) => `${c.name} — ${c.teacher}`),
          timezone: workspace.profile.timezone || APP_TZ,
          clientId: clientId(),
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        items?: CapturedItem[];
        dropped?: number;
        note?: string;
        message?: string;
      };

      if (!payload.ok) {
        toast.error("Could not file that", { description: payload.message });
        return;
      }

      const items = payload.items ?? [];
      if (payload.dropped) {
        console.warn(`[capture] ${payload.dropped} item(s) came back malformed and were skipped`);
      }
      if (items.length === 0) {
        toast("Nothing to file", {
          description: payload.note ?? "Try naming what you want to do or remember.",
        });
        return;
      }

      // Ids of what actually got written, so Undo can take exactly that back.
      const savedTasks: string[] = [];
      const savedNotes: string[] = [];
      let events = 0;

      for (const item of items) {
        const course = item.courseName
          ? workspace.courses.find((c) => c.name === item.courseName)
          : undefined;
        // An explicit class page always wins over whatever the model guessed.
        const resolvedCourseId = courseId ?? course?.id;

        if (item.kind === "note") {
          const note = await createNote({
            courseId: resolvedCourseId,
            kind: item.noteKind ?? "thought",
            body: item.description ? `${item.title} — ${item.description}` : item.title,
          });
          if (note) savedNotes.push(note.id);
          continue;
        }

        if (item.kind === "event" && item.startAt) {
          const saved = await captureEvent({
            title: item.title,
            description: item.description ?? undefined,
            location: item.location ?? undefined,
            startAt: item.startAt,
            endAt: item.endAt ?? undefined,
            allDay: item.allDay,
            kind: "personal",
          });
          if (saved) events += 1;
          continue;
        }

        const task = await createTask({
          title: item.title,
          description: item.description ?? undefined,
          category: resolvedCourseId ? "school" : item.category,
          courseId: resolvedCourseId,
          dueAt: item.dueAt ?? undefined,
          dueAllDay: item.allDay,
          priority: item.priority,
          // The model returns 0 for anything it does not think takes time.
          // That is right for a note and wrong for a task, which needs a real
          // number for the "does this fit your next 45 minutes" ranking.
          estimateMin: item.estimateMin >= 5 ? item.estimateMin : 30,
          source: "manual",
        });
        if (task) savedTasks.push(task.id);
      }

      setText("");
      inputRef.current?.focus();

      const parts = [
        savedTasks.length ? `${savedTasks.length} task${savedTasks.length === 1 ? "" : "s"}` : "",
        events ? `${events} event${events === 1 ? "" : "s"}` : "",
        savedNotes.length ? `${savedNotes.length} note${savedNotes.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean);

      toast.success(`Saved ${parts.join(" · ")}`, {
        description: items[0]?.title,
        // Events are not undone here: they are deduplicated by content, so
        // re-capturing the same one updates it rather than adding a second.
        action:
          savedTasks.length + savedNotes.length > 0
            ? {
                label: "Undo",
                onClick: () => {
                  void Promise.all([
                    ...savedTasks.map((id) => deleteTask(id)),
                    ...savedNotes.map((id) => deleteNote(id)),
                  ]);
                },
              }
            : undefined,
      });
    } catch {
      toast.error("Could not reach the server", { description: "Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-[14px] border border-border bg-card p-2 transition-colors focus-within:border-foreground/20",
        className,
      )}
    >
      <Textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        // Enter files it; Shift+Enter is a newline, so pasting a multi-line
        // email and then pressing Enter still works the way it reads.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        rows={2}
        disabled={busy}
        aria-label="Capture anything"
        className="min-h-[52px] resize-none border-0 bg-transparent px-2 py-1.5 text-[13.5px] shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-0.5 pt-1">
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          Sorts itself into tasks, events and class notes
        </p>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-[12px]"
          disabled={busy || text.trim().length === 0}
          onClick={() => void submit()}
        >
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Filing…
            </>
          ) : (
            <>
              Save <CornerDownLeft className="size-3.5" aria-hidden />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

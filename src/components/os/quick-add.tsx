import { CalendarClock, Loader2, Sparkles, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseTaskInput, type TaskDraft } from "@/lib/core/nl-task";
import { formatDuration, formatTime, relativeDayLabel } from "@/lib/core/time";
import { useOS } from "@/lib/store";
import { proposeTaskFromText } from "@/lib/compass/client";

/** Long enough to be a real task rather than a half-typed word. */
const AUTO_REFINE_MIN_CHARS = 6;
/** A pause in typing, not a keystroke. */
const AUTO_REFINE_DELAY_MS = 900;

const EXAMPLES = [
  "Finish Algebra 2 worksheet tomorrow at 6 PM for 30 minutes",
  "Email Jeremy about landing page ownership friday",
  "Read biology chapter 4 for 25 min",
];

export function TaskDraftPreview({
  draft,
  origin,
}: {
  draft: TaskDraft;
  origin: "parsed" | "compass";
}) {
  return (
    <div className="rounded-[12px] border border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Preview
        </p>
        <Pill tone={origin === "compass" ? "primary" : "neutral"}>
          {origin === "compass" ? "Compass draft" : "Parsed locally"}
        </Pill>
      </div>
      <p className="mt-1.5 text-[13.5px] font-medium">{draft.title}</p>
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
        {draft.projectName ? <Pill tone="neutral">{draft.projectName}</Pill> : null}
      </div>
      {draft.subtasks && draft.subtasks.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {draft.subtasks.map((s) => (
            <li key={s} className="text-[12px] text-muted-foreground">
              · {s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function QuickAdd() {
  const { quickAddOpen, setQuickAddOpen, workspace, createTask } = useOS();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [compassDraft, setCompassDraft] = useState<TaskDraft | null>(null);
  const [compassBusy, setCompassBusy] = useState(false);
  const [compassError, setCompassError] = useState<string | null>(null);

  const courses = useMemo(() => workspace.courses.map((c) => c.name), [workspace.courses]);
  const projects = useMemo(() => workspace.projects.map((p) => p.name), [workspace.projects]);

  const parsed = useMemo(
    () => (value.trim() ? parseTaskInput(value, { courses, projects }) : null),
    [value, courses, projects],
  );
  const draft = compassDraft ?? parsed;

  useEffect(() => {
    if (!quickAddOpen) {
      setValue("");
      setCompassDraft(null);
      setCompassError(null);
    }
  }, [quickAddOpen]);

  useEffect(() => {
    setCompassDraft(null);
  }, [value]);

  /**
   * Compass runs on its own once you stop typing — no button press.
   *
   * The local parser still renders instantly, so the preview is never empty
   * while the model is thinking; the Compass draft replaces it when it lands.
   *
   * Three guards keep this from burning the daily AI budget, which a call per
   * keystroke would exhaust in one sentence:
   *   - it waits for a pause in typing rather than firing on every change,
   *   - it ignores anything too short to be a real task, and
   *   - it never asks twice about the same text, so reopening the dialog or
   *     editing back to a previous value costs nothing.
   */
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    const text = value.trim();
    if (!quickAddOpen) return;
    if (text.length < AUTO_REFINE_MIN_CHARS) return;
    if (requestedFor.current === text) return;

    const timer = window.setTimeout(() => {
      requestedFor.current = text;
      void runCompass(text);
    }, AUTO_REFINE_DELAY_MS);

    return () => window.clearTimeout(timer);
    // `runCompass` is stable for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, quickAddOpen]);

  useEffect(() => {
    if (!quickAddOpen) requestedFor.current = null;
  }, [quickAddOpen]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    const course = workspace.courses.find((c) => c.name === draft.courseName);
    const project = workspace.projects.find((p) => p.name === draft.projectName);
    const created = await createTask({
      title: draft.title,
      description: draft.description,
      category: draft.category,
      courseId: course?.id,
      projectId: project?.id,
      dueAt: draft.dueAt,
      dueAllDay: draft.dueAllDay,
      priority: draft.priority,
      estimateMin: draft.estimateMin,
      notes: draft.notes,
      source: "manual",
      subtasks: draft.subtasks?.map((title) => ({ title })),
    });
    setSaving(false);
    if (created) {
      toast.success("Task added", { description: created.title });
      setQuickAddOpen(false);
    }
  }

  async function runCompass(text: string) {
    setCompassBusy(true);
    setCompassError(null);
    const result = await proposeTaskFromText(text, { courses, projects });
    setCompassBusy(false);
    // Ignore a result that arrived after the text moved on, or it would
    // overwrite the preview with a draft of something already edited away.
    if (text !== valueRef.current.trim()) return;
    if (result.ok) setCompassDraft(result.draft);
    else setCompassError(result.error);
  }

  /** Lets the async callback above compare against the latest text. */
  const valueRef = useRef(value);
  valueRef.current = value;

  /** Manual retry, for when the automatic pass failed. */
  async function askCompass() {
    const text = value.trim();
    if (!text) return;
    requestedFor.current = text;
    await runCompass(text);
  }

  return (
    <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Quick add</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Write it the way you would say it — Compass reads it as you type. Nothing is saved until
            you confirm.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-3"
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Finish Algebra 2 worksheet tomorrow at 6 PM for 30 minutes"
            aria-label="Task description"
            className="h-10 text-[13px]"
          />

          {!value.trim() ? (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Try</p>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setValue(example)}
                  className="block w-full truncate rounded-md px-2 py-1 text-left text-[12.5px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null}

          {draft ? (
            <TaskDraftPreview draft={draft} origin={compassDraft ? "compass" : "parsed"} />
          ) : null}

          {compassError ? (
            <p role="alert" className="text-[12px] text-urgent">
              {compassError}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[12.5px]"
              disabled={!value.trim() || compassBusy}
              onClick={() => void askCompass()}
            >
              {compassBusy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-3.5" aria-hidden />
              )}
              {compassError ? "Try Compass again" : "Refine with Compass"}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[12.5px]"
                onClick={() => setQuickAddOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 text-[12.5px]"
                disabled={!draft || saving}
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                Add task
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

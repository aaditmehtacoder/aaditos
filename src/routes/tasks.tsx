import { createFileRoute } from "@tanstack/react-router";
import { Archive, Inbox, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  KeyValue,
  Panel,
  PanelHeader,
  Pill,
  RowSkeleton,
  Segmented,
  SourceTag,
} from "@/components/os/primitives";
import { useModifierKey } from "@/components/os/kbd";
import { TaskRow } from "@/components/os/task-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { dayDiff, formatDuration, formatTime, relativeDayLabel } from "@/lib/core/time";
import { PRIORITIES, type Priority, type Task } from "@/lib/core/types";
import { useOS } from "@/lib/store";

type View = "today" | "upcoming" | "inbox" | "completed" | "all";
type SortKey = "smart" | "due" | "priority" | "created" | "estimate";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks · AaditOS" },
      { name: "description", content: "Every task across school, work and personal life." },
    ],
  }),
  component: TasksPage,
});

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function TaskDetail({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { updateTask, deleteTask, workspace } = useOS();
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  if (!task) return null;
  const course = workspace.courses.find((c) => c.id === task.courseId);
  const project = workspace.projects.find((p) => p.id === task.projectId);

  return (
    <Sheet open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-1">
          <SheetTitle className="pr-6 text-[15px] leading-snug">{task.title}</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {task.status === "done" ? "Completed" : "Open"} ·{" "}
            {task.dueAt ? `due ${relativeDayLabel(task.dueAt)}` : "no due date"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {task.description ? (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {task.description}
            </p>
          ) : null}

          <dl className="divide-y divide-border">
            <KeyValue label="Status">
              <Select
                value={task.status}
                onValueChange={(value) =>
                  void updateTask(task.id, { status: value as Task["status"] })
                }
              >
                <SelectTrigger className="h-8 text-[12.5px]" aria-label="Task status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To do</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </KeyValue>
            <KeyValue label="Priority">
              <Select
                value={task.priority}
                onValueChange={(value) => void updateTask(task.id, { priority: value as Priority })}
              >
                <SelectTrigger className="h-8 text-[12.5px]" aria-label="Task priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </KeyValue>
            <KeyValue label="Due">
              <input
                type="datetime-local"
                aria-label="Due date and time"
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12.5px]"
                value={task.dueAt ? toLocalInput(task.dueAt) : ""}
                onChange={(e) =>
                  void updateTask(task.id, {
                    dueAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    dueAllDay: false,
                  })
                }
              />
            </KeyValue>
            <KeyValue label="Estimate">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  aria-label="Estimated minutes"
                  className="h-8 w-24 text-[12.5px]"
                  value={task.estimateMin}
                  onChange={(e) =>
                    void updateTask(task.id, {
                      estimateMin: Math.max(5, Math.min(600, Number(e.target.value) || 30)),
                    })
                  }
                />
                <span className="text-[12px] text-muted-foreground">minutes</span>
              </div>
            </KeyValue>
            <KeyValue label="Category">{task.category}</KeyValue>
            {course ? <KeyValue label="Course">{course.name}</KeyValue> : null}
            {project ? <KeyValue label="Project">{project.name}</KeyValue> : null}
            <KeyValue label="Source">
              <SourceTag source={task.source} />
            </KeyValue>
            {task.actualMin ? (
              <KeyValue label="Time spent">{formatDuration(task.actualMin)}</KeyValue>
            ) : null}
            <KeyValue label="Created">{relativeDayLabel(task.createdAt)}</KeyValue>
            <KeyValue label="Updated">{relativeDayLabel(task.updatedAt)}</KeyValue>
          </dl>

          {task.subtasks.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Subtasks
              </p>
              <ul className="space-y-1.5">
                {task.subtasks.map((subtask) => (
                  <li key={subtask.id} className="flex items-start gap-2">
                    <Checkbox
                      checked={subtask.done}
                      aria-label={subtask.title}
                      className="mt-0.5"
                      onCheckedChange={() =>
                        void updateTask(task.id, {
                          subtasks: task.subtasks.map((s) =>
                            s.id === subtask.id ? { ...s, done: !s.done } : s,
                          ),
                        })
                      }
                    />
                    <span
                      className={
                        subtask.done
                          ? "text-[12.5px] text-muted-foreground line-through"
                          : "text-[12.5px]"
                      }
                    >
                      {subtask.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <label
              htmlFor="task-notes"
              className="mb-2 block text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Notes
            </label>
            <Textarea
              id="task-notes"
              value={notes}
              rows={4}
              className="text-[12.5px]"
              placeholder="Anything you want to remember about this task."
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-8 text-[12.5px]"
              disabled={savingNotes || notes === (task.notes ?? "")}
              onClick={() => {
                setSavingNotes(true);
                void updateTask(task.id, { notes: notes || undefined }).finally(() => {
                  setSavingNotes(false);
                  toast.success("Notes saved");
                });
              }}
            >
              Save notes
            </Button>
          </div>

          {task.externalUrl ? (
            <a
              href={task.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block text-[12.5px] text-primary underline underline-offset-2"
            >
              Open in the source app
            </a>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12.5px]"
              onClick={() => void updateTask(task.id, { status: "archived" })}
            >
              <Archive className="size-3.5" aria-hidden /> Archive
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12.5px] text-urgent hover:text-urgent"
              onClick={() => {
                void deleteTask(task.id);
                toast.success("Task deleted");
                onClose();
              }}
            >
              <Trash2 className="size-3.5" aria-hidden /> Delete
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function TasksPage() {
  const { workspace, status, now, setQuickAddOpen, updateTask } = useOS();
  const [view, setView] = useState<View>("today");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [context, setContext] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("smart");
  const [selected, setSelected] = useState<Task | null>(null);
  const modifier = useModifierKey();

  const contextOptions = useMemo(
    () => [
      ...workspace.courses.map((c) => ({ value: `course:${c.id}`, label: c.name })),
      ...workspace.projects.map((p) => ({ value: `project:${p.id}`, label: p.name })),
    ],
    [workspace.courses, workspace.projects],
  );

  const sources = useMemo(
    () => Array.from(new Set(workspace.tasks.map((t) => t.source))),
    [workspace.tasks],
  );

  const counts = useMemo(() => {
    const open = workspace.tasks.filter((t) => t.status !== "done" && t.status !== "archived");
    return {
      today: open.filter((t) => t.dueAt && dayDiff(now, t.dueAt) <= 0).length,
      upcoming: open.filter((t) => t.dueAt && dayDiff(now, t.dueAt) > 0).length,
      inbox: open.filter((t) => !t.dueAt).length,
      completed: workspace.tasks.filter((t) => t.status === "done").length,
      all: workspace.tasks.length,
    };
  }, [workspace.tasks, now]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = workspace.tasks.filter((t) => !t.deletedAt);

    switch (view) {
      case "today":
        list = list.filter(
          (t) =>
            t.status !== "done" && t.status !== "archived" && t.dueAt && dayDiff(now, t.dueAt) <= 0,
        );
        break;
      case "upcoming":
        list = list.filter(
          (t) =>
            t.status !== "done" && t.status !== "archived" && t.dueAt && dayDiff(now, t.dueAt) > 0,
        );
        break;
      case "inbox":
        list = list.filter((t) => t.status !== "done" && t.status !== "archived" && !t.dueAt);
        break;
      case "completed":
        list = list.filter((t) => t.status === "done");
        break;
      default:
        break;
    }

    if (category !== "all") list = list.filter((t) => t.category === category);
    if (priority !== "all") list = list.filter((t) => t.priority === priority);
    if (source !== "all") list = list.filter((t) => t.source === source);
    if (context !== "all") {
      const [kind, id] = context.split(":");
      list = list.filter((t) => (kind === "course" ? t.courseId === id : t.projectId === id));
    }
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q) ||
          (t.notes ?? "").toLowerCase().includes(q),
      );
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "due": {
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue;
        }
        case "priority":
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        case "created":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "estimate":
          return a.estimateMin - b.estimateMin;
        default: {
          if (a.position !== b.position) return a.position - b.position;
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue;
        }
      }
    });
    return sorted;
  }, [workspace.tasks, view, category, priority, source, context, query, sort, now]);

  const activeFilters =
    (category !== "all" ? 1 : 0) +
    (priority !== "all" ? 1 : 0) +
    (source !== "all" ? 1 : 0) +
    (context !== "all" ? 1 : 0) +
    (query.trim() ? 1 : 0);

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="display text-[23px]">Tasks</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {counts.today} due today · {counts.upcoming} upcoming · {counts.inbox} without a date
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[12.5px]"
          onClick={() => setQuickAddOpen(true)}
        >
          <Plus className="size-3.5" aria-hidden /> New task
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <Segmented
          label="Task view"
          value={view}
          onChange={setView}
          options={[
            { value: "today", label: "Today", count: counts.today },
            { value: "upcoming", label: "Upcoming", count: counts.upcoming },
            { value: "inbox", label: "Inbox", count: counts.inbox },
            { value: "completed", label: "Completed", count: counts.completed },
            { value: "all", label: "All", count: counts.all },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-4">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>

        <FilterSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={[
            { value: "all", label: "All categories" },
            { value: "school", label: "School" },
            { value: "work", label: "Work" },
            { value: "personal", label: "Personal" },
          ]}
        />
        <FilterSelect
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={[
            { value: "all", label: "Any priority" },
            ...PRIORITIES.map((p) => ({ value: p, label: p })),
          ]}
        />
        <FilterSelect
          label="Course or project"
          value={context}
          onChange={setContext}
          options={[{ value: "all", label: "All contexts" }, ...contextOptions]}
        />
        <FilterSelect
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "Any source" },
            ...sources.map((s) => ({ value: s, label: s })),
          ]}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          options={[
            { value: "smart", label: "Sort: manual order" },
            { value: "due", label: "Sort: due date" },
            { value: "priority", label: "Sort: priority" },
            { value: "estimate", label: "Sort: shortest first" },
            { value: "created", label: "Sort: newest" },
          ]}
        />

        {activeFilters > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1 text-[12.5px]"
            onClick={() => {
              setCategory("all");
              setPriority("all");
              setSource("all");
              setContext("all");
              setQuery("");
            }}
          >
            <X className="size-3.5" aria-hidden /> Clear {activeFilters}
          </Button>
        ) : null}
      </div>

      <Panel>
        <PanelHeader
          title={`${filtered.length} task${filtered.length === 1 ? "" : "s"}`}
          meta={sort === "smart" ? "Drag order — reorder with the row arrows" : undefined}
          action={
            view === "completed" && filtered.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-[12px]"
                onClick={() => {
                  filtered.forEach((t) => void updateTask(t.id, { status: "todo" }));
                  toast.success(`Reopened ${filtered.length} tasks`);
                }}
              >
                <RotateCcw className="size-3.5" aria-hidden /> Reopen all
              </Button>
            ) : null
          }
        />
        {status === "loading" ? (
          <RowSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={activeFilters > 0 ? "No tasks match these filters" : "Nothing here"}
            description={
              activeFilters > 0
                ? "Try clearing a filter or searching for something else."
                : view === "completed"
                  ? "Completed tasks will collect here."
                  : `Add a task with Quick add, or press ${modifier === "⌘" ? "⌘J" : "Ctrl+J"} from anywhere.`
            }
            action={
              activeFilters === 0 ? (
                <Button
                  size="sm"
                  className="h-8 text-[12.5px]"
                  onClick={() => setQuickAddOpen(true)}
                >
                  New task
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                showReorder={sort === "smart"}
                onOpen={setSelected}
              />
            ))}
          </div>
        )}
      </Panel>

      {filtered.length > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          <Pill tone="neutral">
            {formatDuration(filtered.reduce((sum, t) => sum + t.estimateMin, 0))} of estimated work
          </Pill>
          {filtered.some((t) => t.dueAt && dayDiff(now, t.dueAt) < 0) ? (
            <Pill tone="urgent">
              {filtered.filter((t) => t.dueAt && dayDiff(now, t.dueAt) < 0).length} overdue
            </Pill>
          ) : null}
          {filtered[0]?.dueAt ? (
            <span>
              Next deadline {relativeDayLabel(filtered[0].dueAt)} at {formatTime(filtered[0].dueAt)}
            </span>
          ) : null}
        </p>
      ) : null}

      <TaskDetail
        task={selected ? (workspace.tasks.find((t) => t.id === selected.id) ?? null) : null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[140px] text-[12.5px]" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-[12.5px]">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

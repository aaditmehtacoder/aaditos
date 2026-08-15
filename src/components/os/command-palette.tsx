import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  FolderGit2,
  GraduationCap,
  Layers,
  Monitor,
  Moon,
  Plug,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Target,
  Timer,
} from "lucide-react";
import { useMemo } from "react";

import { Kbd } from "@/components/os/kbd";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { relativeDayLabel } from "@/lib/core/time";
import { useOS } from "@/lib/store";

const DESTINATIONS = [
  { to: "/", label: "Today", icon: Layers },
  { to: "/school", label: "School", icon: CalendarDays },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/projects", label: "Projects", icon: FolderGit2 },
  { to: "/opportunities", label: "Opportunities", icon: Target },
  { to: "/focus", label: "Focus", icon: Timer },
  { to: "/compass", label: "Compass", icon: Sparkles },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setQuickAddOpen, theme, setTheme, workspace } = useOS();
  const navigate = useNavigate();

  const go = (to: string) => {
    setPaletteOpen(false);
    void navigate({ to });
  };

  const courseName = useMemo(() => {
    const map = new Map(workspace.courses.map((c) => [c.id, c.name]));
    return (id?: string) => (id ? (map.get(id) ?? "") : "");
  }, [workspace.courses]);

  const openTasks = workspace.tasks
    .filter((t) => t.status !== "done" && t.status !== "archived")
    .slice(0, 20);

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      title="Command palette"
      description="Search tasks, assignments, events, projects and opportunities"
    >
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No matches. Try a task title, a course, or a project name.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            value="quick add new task capture"
            onSelect={() => {
              setPaletteOpen(false);
              setQuickAddOpen(true);
            }}
          >
            <Plus /> Quick-add a task
            <Kbd className="ml-auto">J</Kbd>
          </CommandItem>
          <CommandItem value="focus session timer start" onSelect={() => go("/focus")}>
            <Timer /> Start a focus session
          </CommandItem>
          <CommandItem value="compass ai assistant ask" onSelect={() => go("/compass")}>
            <Sparkles /> Ask Compass
          </CommandItem>
          <CommandItem
            value="theme light appearance"
            onSelect={() => {
              setTheme("light");
              setPaletteOpen(false);
            }}
          >
            <Sun /> Light theme {theme === "light" ? "· active" : ""}
          </CommandItem>
          <CommandItem
            value="theme dark appearance"
            onSelect={() => {
              setTheme("dark");
              setPaletteOpen(false);
            }}
          >
            <Moon /> Dark theme {theme === "dark" ? "· active" : ""}
          </CommandItem>
          <CommandItem
            value="theme system appearance auto"
            onSelect={() => {
              setTheme("system");
              setPaletteOpen(false);
            }}
          >
            <Monitor /> Match system theme {theme === "system" ? "· active" : ""}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to">
          {DESTINATIONS.map((d) => (
            <CommandItem key={d.to} value={`go ${d.label}`} onSelect={() => go(d.to)}>
              <d.icon /> {d.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {openTasks.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tasks">
              {openTasks.map((t) => (
                <CommandItem key={t.id} value={`task ${t.title}`} onSelect={() => go("/tasks")}>
                  <CheckSquare />
                  <span className="truncate">{t.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {t.dueAt ? relativeDayLabel(t.dueAt) : "No date"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {workspace.assignments.length > 0 ? (
          <CommandGroup heading="Assignments">
            {workspace.assignments.slice(0, 12).map((a) => (
              <CommandItem
                key={a.id}
                value={`assignment ${a.title} ${courseName(a.courseId)}`}
                onSelect={() => go("/school")}
              >
                <GraduationCap />
                <span className="truncate">{a.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {courseName(a.courseId)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {workspace.projects.length > 0 ? (
          <CommandGroup heading="Projects">
            {workspace.projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.objective}`}
                onSelect={() => go(`/projects/${p.id}`)}
              >
                <FolderGit2 />
                <span className="truncate">{p.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {workspace.opportunities.length > 0 ? (
          <CommandGroup heading="Opportunities">
            {workspace.opportunities.slice(0, 12).map((o) => (
              <CommandItem
                key={o.id}
                value={`opportunity ${o.title} ${o.org}`}
                onSelect={() => go("/opportunities")}
              >
                <Target />
                <span className="truncate">{o.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{o.org}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {workspace.events.length > 0 ? (
          <CommandGroup heading="Events">
            {workspace.events.slice(0, 12).map((e) => (
              <CommandItem key={e.id} value={`event ${e.title}`} onSelect={() => go("/school")}>
                <CalendarDays />
                <span className="truncate">{e.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {relativeDayLabel(e.startAt)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

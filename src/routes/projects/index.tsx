import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, GitBranch, RefreshCw, TriangleAlert } from "lucide-react";

import {
  EmptyState,
  Panel,
  Pill,
  ProgressBar,
  RowSkeleton,
  SourceTag,
} from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { relativeDayLabel } from "@/lib/core/time";
import type { ProjectHealth } from "@/lib/core/types";
import { useSync } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "Projects · AaditOS" },
      { name: "description", content: "Venu AI, Pick44, Origami Prep, OpenRubric and more." },
    ],
  }),
  component: ProjectsPage,
});

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: "On track",
  attention: "Needs attention",
  at_risk: "At risk",
};

export const HEALTH_TONE: Record<ProjectHealth, "success" | "warning" | "urgent"> = {
  on_track: "success",
  attention: "warning",
  at_risk: "urgent",
};

function ProjectsPage() {
  const { workspace, status } = useOS();
  const { sync, running, lastPayload } = useSync();

  const openTasksFor = (projectId: string) =>
    workspace.tasks.filter(
      (t) => t.projectId === projectId && t.status !== "done" && t.status !== "archived",
    );

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[1200px]">
        <Panel>
          <RowSkeleton rows={6} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-5">
        <div className="min-w-0">
          <h1 className="display text-[23px]">Projects</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {workspace.projects.length} projects ·{" "}
            {workspace.projects.filter((p) => p.health === "at_risk").length} at risk ·{" "}
            {workspace.projects.reduce((n, p) => n + p.blockers.length, 0)} blockers
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[12.5px]"
          disabled={running}
          onClick={() => void sync(["github", "vercel"])}
        >
          <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
          Sync GitHub &amp; Vercel
        </Button>
      </div>

      {lastPayload?.github && !lastPayload.github.configured ? (
        <p className="mb-4 rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
          GitHub is not configured on the server, so repository activity below comes from your saved
          project data rather than live GitHub. Add{" "}
          <code className="rounded bg-secondary px-1">GITHUB_TOKEN</code> to enable it.
        </p>
      ) : null}

      {workspace.projects.length === 0 ? (
        <Panel>
          <EmptyState
            title="No projects yet"
            description="Projects group tasks, deadlines, GitHub repositories and deployments in one place."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspace.projects.map((project) => {
            const openTasks = openTasksFor(project.id);
            const live = lastPayload?.github?.repos.find((r) => r.repo === project.githubRepo);
            const failedRuns = live?.failedRuns.length ?? 0;
            return (
              <Panel key={project.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-[14.5px] font-semibold tracking-tight">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.id }}
                        className="transition-colors duration-150 hover:text-primary"
                      >
                        {project.name}
                      </Link>
                    </h2>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {project.kind}
                    </p>
                  </div>
                  <Pill tone={HEALTH_TONE[project.health]}>{HEALTH_LABEL[project.health]}</Pill>
                </div>

                <p className="mt-2.5 line-clamp-2 text-[12.5px] text-muted-foreground">
                  {project.objective}
                </p>

                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11.5px]">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="tabular-nums">{project.progress}%</span>
                  </div>
                  <ProgressBar
                    value={project.progress}
                    label={`${project.name} progress`}
                    tone={HEALTH_TONE[project.health] === "urgent" ? "urgent" : "primary"}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Pill tone="neutral">{openTasks.length} open tasks</Pill>
                  {project.deadlineAt ? (
                    <Pill tone="neutral">
                      {project.deadlineLabel ?? "Deadline"} · {relativeDayLabel(project.deadlineAt)}
                    </Pill>
                  ) : null}
                  {failedRuns > 0 ? (
                    <Pill tone="urgent">
                      <TriangleAlert className="size-3" aria-hidden />
                      {failedRuns} failed run{failedRuns === 1 ? "" : "s"}
                    </Pill>
                  ) : null}
                </div>

                {project.blockers.length > 0 ? (
                  <ul className="mt-3 space-y-1 border-t border-border pt-2.5">
                    {project.blockers.map((blocker) => (
                      <li
                        key={blocker}
                        className="flex items-start gap-1.5 text-[12px] text-warning-strong"
                      >
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                        {blocker}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {project.githubRepo ? (
                      <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
                        <GitBranch className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{project.githubRepo}</span>
                      </span>
                    ) : (
                      <SourceTag source="manual" />
                    )}
                  </div>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="-mr-1.5 inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  >
                    Open <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

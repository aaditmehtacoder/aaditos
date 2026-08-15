import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import {
  EmptyState,
  KeyValue,
  Panel,
  PanelHeader,
  Pill,
  ProgressBar,
  Segmented,
  SourceTag,
  Stat,
} from "@/components/os/primitives";
import { TaskRow } from "@/components/os/task-row";
import { Button } from "@/components/ui/button";
import { formatDuration, relativeDayLabel, relativeTimeLabel } from "@/lib/core/time";
import { useSync } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";

import { HEALTH_LABEL, HEALTH_TONE } from "./index";

type Tab = "overview" | "tasks" | "activity" | "github" | "documents" | "metrics";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project · AaditOS" }] }),
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const { workspace } = useOS();
  const { sync, running, lastPayload } = useSync();
  const [tab, setTab] = useState<Tab>("overview");

  const project = workspace.projects.find((p) => p.id === projectId);

  if (!project) {
    return (
      <div className="mx-auto max-w-[900px]">
        <Panel>
          <EmptyState
            title="Project not found"
            description="This project does not exist in your workspace."
            action={
              <Button size="sm" className="h-8 text-[12.5px]" asChild>
                <Link to="/projects">Back to projects</Link>
              </Button>
            }
          />
        </Panel>
      </div>
    );
  }

  const tasks = workspace.tasks.filter((t) => t.projectId === project.id);
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "archived");
  const doneTasks = tasks.filter((t) => t.status === "done");
  const live = lastPayload?.github?.repos.find((r) => r.repo === project.githubRepo);
  const deployments =
    lastPayload?.vercel?.deployments.filter(
      (d) => !project.vercelProject || d.project === project.vercelProject,
    ) ?? [];

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link
        to="/projects"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden /> Projects
      </Link>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display text-[23px]">{project.name}</h1>
            <Pill tone={HEALTH_TONE[project.health]}>{HEALTH_LABEL[project.health]}</Pill>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{project.objective}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[12.5px]"
          disabled={running}
          onClick={() => void sync(["github", "vercel"])}
        >
          <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
          Sync
        </Button>
      </div>

      <div className="pb-4">
        <Segmented
          label="Project section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "tasks", label: "Tasks", count: openTasks.length },
            { value: "activity", label: "Activity" },
            { value: "github", label: "GitHub" },
            { value: "documents", label: "Documents" },
            { value: "metrics", label: "Metrics" },
          ]}
        />
      </div>

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Current objective" />
              <div className="px-4 py-3">
                <p className="text-[13px]">{project.objective}</p>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11.5px]">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="tabular-nums">{project.progress}%</span>
                  </div>
                  <ProgressBar value={project.progress} label={`${project.name} progress`} />
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Next actions" meta={`${openTasks.length} open`} />
              {openTasks.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="No open tasks"
                  description="Add a task and assign it to this project to see it here."
                />
              ) : (
                <div className="divide-y divide-border">
                  {openTasks.slice(0, 6).map((task) => (
                    <TaskRow key={task.id} task={task} dense />
                  ))}
                </div>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Blockers" meta={`${project.blockers.length}`} />
              {project.blockers.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nothing is blocked"
                  description="Blockers you record show up here and on the projects list."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {project.blockers.map((blocker) => (
                    <li key={blocker} className="flex items-start gap-2 px-4 py-2.5 text-[12.5px]">
                      <TriangleAlert
                        className="mt-0.5 size-3.5 shrink-0 text-warning"
                        aria-hidden
                      />
                      {blocker}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Details" />
              <dl className="divide-y divide-border px-4 py-1">
                <KeyValue label="Kind">{project.kind}</KeyValue>
                {project.contact ? <KeyValue label="Contact">{project.contact}</KeyValue> : null}
                {project.deadlineAt ? (
                  <KeyValue label="Deadline">
                    {project.deadlineLabel ?? "Deadline"} · {relativeDayLabel(project.deadlineAt)}
                  </KeyValue>
                ) : null}
                <KeyValue label="Tasks">
                  {doneTasks.length} done / {tasks.length} total
                </KeyValue>
                <KeyValue label="Estimated work">
                  {formatDuration(openTasks.reduce((s, t) => s + t.estimateMin, 0))}
                </KeyValue>
              </dl>
            </Panel>

            <Panel>
              <PanelHeader title="Links" />
              {project.links.length === 0 && !project.githubRepo && !project.vercelProject ? (
                <p className="px-4 py-4 text-[12px] text-muted-foreground">No links yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {project.githubRepo ? (
                    <li>
                      <a
                        href={`https://github.com/${project.githubRepo}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-2 px-4 py-2.5 text-[12.5px] transition-colors duration-150 hover:bg-muted/50"
                      >
                        <GitBranch
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="truncate">{project.githubRepo}</span>
                        <ExternalLink
                          className="ml-auto size-3 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </a>
                    </li>
                  ) : null}
                  {project.links.map((link) => (
                    <li key={link.url}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-2 px-4 py-2.5 text-[12.5px] transition-colors duration-150 hover:bg-muted/50"
                      >
                        <span className="truncate">{link.label}</span>
                        <ExternalLink
                          className="ml-auto size-3 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <Panel>
          <PanelHeader title="Tasks" meta={`${openTasks.length} open · ${doneTasks.length} done`} />
          {tasks.length === 0 ? (
            <EmptyState
              title="No tasks for this project"
              description="Create a task and pick this project to link them."
            />
          ) : (
            <div className="divide-y divide-border">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "activity" ? (
        <Panel>
          <PanelHeader title="Recent activity" meta={`${project.activity.length} items`} />
          {project.activity.length === 0 ? (
            <EmptyState
              title="No activity recorded"
              description="Sync GitHub and Vercel to pull commits, runs and deployments."
            />
          ) : (
            <ol className="divide-y divide-border">
              {project.activity.map((item) => (
                <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px]">{item.text}</p>
                    <SourceTag source={item.source} className="mt-1" />
                  </div>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {relativeTimeLabel(item.at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      ) : null}

      {tab === "github" ? (
        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="GitHub"
              meta={project.githubRepo ?? "No repository linked"}
              action={
                project.githubRepo ? (
                  <a
                    href={`https://github.com/${project.githubRepo}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Open <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : null
              }
            />
            {!project.githubRepo ? (
              <EmptyState
                title="No repository linked"
                description="Link a repository to this project to see issues, pull requests and Action runs."
              />
            ) : !lastPayload?.github ? (
              <EmptyState
                title="Not synced yet"
                description="Run a sync to pull live issues, pull requests and workflow runs from GitHub."
                action={
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-[12.5px]"
                    disabled={running}
                    onClick={() => void sync(["github"])}
                  >
                    <RefreshCw
                      className={running ? "size-3.5 animate-spin" : "size-3.5"}
                      aria-hidden
                    />
                    Sync GitHub
                  </Button>
                }
              />
            ) : !lastPayload.github.configured ? (
              <EmptyState
                icon={TriangleAlert}
                title="GitHub is not configured"
                description="Add GITHUB_TOKEN on the server to enable live repository data. Nothing is fabricated in the meantime."
              />
            ) : live?.error ? (
              <EmptyState
                icon={TriangleAlert}
                title="GitHub request failed"
                description={live.error}
              />
            ) : live ? (
              <>
                <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-3">
                  <Stat label="Open issues" value={String(live.openIssues)} />
                  <Stat label="Open PRs" value={String(live.openPullRequests)} />
                  <Stat
                    label="Failed runs"
                    value={String(live.failedRuns.length)}
                    hint={live.failedRuns.length ? "Needs attention" : "All green"}
                  />
                </div>
                {live.lastCommit ? (
                  <div className="border-t border-border px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Latest commit
                    </p>
                    <a
                      href={live.lastCommit.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 block truncate text-[12.5px] underline-offset-2 hover:underline"
                    >
                      {live.lastCommit.message}
                    </a>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {live.lastCommit.author} · {relativeTimeLabel(live.lastCommit.at)}
                    </p>
                  </div>
                ) : null}
                {live.recentRuns.length > 0 ? (
                  <div className="border-t border-border">
                    <PanelHeader title="Workflow runs" meta={`${live.recentRuns.length} recent`} />
                    <ul className="divide-y divide-border">
                      {live.recentRuns.map((run) => (
                        <li
                          key={run.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[12.5px]">{run.name}</p>
                            <p className="text-[11.5px] text-muted-foreground">
                              {run.branch} · {relativeTimeLabel(run.updatedAt)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Pill
                              tone={
                                run.conclusion === "success"
                                  ? "success"
                                  : run.conclusion === "failure"
                                    ? "urgent"
                                    : "neutral"
                              }
                            >
                              {run.conclusion || run.status}
                            </Pill>
                            <a
                              href={run.logsUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-muted-foreground transition-colors hover:text-foreground"
                              aria-label={`Open logs for ${run.name}`}
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                title="Repository not in the last sync"
                description="Run a sync again, or check that the token can read this repository."
              />
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Vercel deployments" meta={project.vercelProject ?? "Not linked"} />
            {!lastPayload?.vercel ? (
              <EmptyState
                title="Not synced yet"
                description="Run a sync to pull deployment status from Vercel."
              />
            ) : !lastPayload.vercel.configured ? (
              <EmptyState
                icon={TriangleAlert}
                title="Vercel is not configured"
                description="Add VERCEL_TOKEN on the server to see production and preview deployments."
              />
            ) : deployments.length === 0 ? (
              <EmptyState
                title="No deployments"
                description="No deployments matched this project."
              />
            ) : (
              <ul className="divide-y divide-border">
                {deployments.slice(0, 8).map((deployment) => (
                  <li
                    key={deployment.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px]">
                        {deployment.project} · {deployment.target}
                      </p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {deployment.branch ?? "—"}
                        {deployment.framework ? ` · ${deployment.framework}` : ""} ·{" "}
                        {relativeTimeLabel(deployment.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Pill
                        tone={
                          deployment.state === "READY"
                            ? "success"
                            : deployment.state === "ERROR"
                              ? "urgent"
                              : "neutral"
                        }
                      >
                        {deployment.state}
                      </Pill>
                      {deployment.url ? (
                        <a
                          href={deployment.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={`Open ${deployment.project} deployment`}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "documents" ? (
        <Panel>
          <PanelHeader title="Documents" meta={`${project.documents.length}`} />
          {project.documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents"
              description="Connect Google Drive to attach scoped project documents."
            />
          ) : (
            <ul className="divide-y divide-border">
              {project.documents.map((doc) => (
                <li key={doc.name} className="flex items-center gap-2 px-4 py-2.5">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px]">{doc.name}</span>
                    <span className="text-[11.5px] text-muted-foreground">{doc.meta}</span>
                  </span>
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`Open ${doc.name}`}
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {tab === "metrics" ? (
        <Panel>
          <PanelHeader title="Metrics" />
          {project.metrics.length === 0 ? (
            <EmptyState title="No metrics" description="Track a few numbers that matter here." />
          ) : (
            <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 sm:divide-y-0">
              {project.metrics.map((metric) => (
                <Stat
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  hint={metric.delta}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

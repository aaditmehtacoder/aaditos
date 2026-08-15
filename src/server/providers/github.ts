/**
 * GitHub adapter — read-only, and structurally unable to be anything else.
 *
 * A classic personal access token carries the `repo` scope, which GitHub does
 * not offer in a read-only form. That means the *token* can write even though
 * this app must not. Rather than rely on a promise in a comment, read-only is
 * enforced here in three ways, each independently checked by the test suite:
 *
 *   1. `gh()` is the only function in this module that calls `fetch`, and it
 *      hardcodes `method: "GET"`. There is no parameter to override it.
 *   2. Every request path is matched against `READ_PATHS` below. A path that
 *      is not on that list throws before any network call happens.
 *   3. `tests/github.test.ts` reads this file's own source and fails the build
 *      if a second `fetch(` appears, or if any non-GET method is introduced.
 *
 * So a future edit that tries to POST, PATCH or DELETE cannot silently ship.
 * The token is never logged, never returned to the client, and never leaves
 * this module.
 */

import type {
  GithubAssignedItem,
  GithubRepoSummary,
  GithubResult,
  GithubWorkflowRun,
} from "@/lib/integrations/contracts";

import { serverEnv } from "../env";

export type { GithubAssignedItem, GithubRepoSummary, GithubResult, GithubWorkflowRun };

const API = "https://api.github.com";

/**
 * The complete set of endpoints this adapter may reach. All are GET-only reads.
 * Adding a capability means adding a pattern here deliberately, in review.
 */
const READ_PATHS: RegExp[] = [
  /^\/issues\?/, //                                    issues assigned to the token owner
  /^\/repos\/[\w.-]+\/[\w.-]+$/, //                     repository metadata
  /^\/repos\/[\w.-]+\/[\w.-]+\/issues\?/, //            open issues and pull requests
  /^\/repos\/[\w.-]+\/[\w.-]+\/commits\?/, //           recent commits
  /^\/repos\/[\w.-]+\/[\w.-]+\/actions\/runs\?/, //     workflow run history
];

export function isReadPath(path: string): boolean {
  return READ_PATHS.some((pattern) => pattern.test(path));
}

async function gh<T>(path: string): Promise<T> {
  const token = serverEnv.githubToken;
  if (!token) throw new Error("GITHUB_TOKEN is not configured");
  if (!isReadPath(path)) {
    // Refuse before the request exists, so an unreviewed endpoint cannot be
    // reached even with a token that would permit it.
    throw new Error(`Refusing to call non-read GitHub path: ${path}`);
  }
  const response = await fetch(`${API}${path}`, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "AaditOS/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(
      remaining === "0"
        ? "GitHub rate limit exhausted for this token"
        : "GitHub rejected the configured token",
    );
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`);
  return (await response.json()) as T;
}

/** Map one raw issue payload to the assigned-item shape. */
export function toAssigned(raw: Record<string, unknown>): GithubAssignedItem {
  const repository = (raw["repository"] ?? {}) as { full_name?: string };
  const labels = Array.isArray(raw["labels"]) ? (raw["labels"] as Array<unknown>) : [];
  return {
    id: Number(raw["id"] ?? 0),
    repo: String(repository.full_name ?? "unknown/unknown"),
    number: Number(raw["number"] ?? 0),
    title: String(raw["title"] ?? "untitled"),
    url: String(raw["html_url"] ?? ""),
    isPullRequest: raw["pull_request"] !== undefined && raw["pull_request"] !== null,
    draft: raw["draft"] === true,
    labels: labels
      .map((l) => (l && typeof l === "object" ? String((l as { name?: string }).name ?? "") : ""))
      .filter(Boolean),
    updatedAt: String(raw["updated_at"] ?? new Date().toISOString()),
    commentCount: Number(raw["comments"] ?? 0),
  };
}

/**
 * Everything currently assigned to the token owner, newest activity first.
 * Independent of the linked-project list, so work in a repo the user has not
 * added as a project still surfaces.
 */
async function fetchAssigned(): Promise<{ items: GithubAssignedItem[]; error?: string }> {
  try {
    const raw = await gh<Array<Record<string, unknown>>>(
      "/issues?filter=assigned&state=open&per_page=50&sort=updated",
    );
    return { items: raw.map(toAssigned) };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "assigned lookup failed",
    };
  }
}

/** Summarize the repositories the user has linked to their projects. */
export async function fetchGithub(repos: string[]): Promise<GithubResult> {
  if (!serverEnv.githubToken) {
    return {
      configured: false,
      ok: false,
      repos: [],
      assigned: [],
      error: "GITHUB_TOKEN is not set",
    };
  }
  const unique = Array.from(new Set(repos.filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)))).slice(0, 8);
  const assignedResult = await fetchAssigned();

  if (unique.length === 0) {
    return {
      configured: true,
      ok: true,
      repos: [],
      assigned: assignedResult.items,
      ...(assignedResult.error ? { assignedError: assignedResult.error } : {}),
      fetchedAt: new Date().toISOString(),
    };
  }

  const summaries = await Promise.all(
    unique.map(async (repo): Promise<GithubRepoSummary> => {
      try {
        const [issues, runsPayload, commits] = await Promise.all([
          gh<Array<{ pull_request?: unknown }>>(`/repos/${repo}/issues?state=open&per_page=100`),
          gh<{ workflow_runs?: Array<Record<string, unknown>> }>(
            `/repos/${repo}/actions/runs?per_page=20`,
          ),
          gh<Array<Record<string, unknown>>>(`/repos/${repo}/commits?per_page=1`),
        ]);

        const runs = (runsPayload.workflow_runs ?? []).map(toRun);
        const head = commits[0] as
          | {
              commit?: { message?: string; author?: { name?: string; date?: string } };
              html_url?: string;
            }
          | undefined;

        return {
          repo,
          openIssues: issues.filter((i) => !i.pull_request).length,
          openPullRequests: issues.filter((i) => i.pull_request).length,
          lastCommit: head
            ? {
                message: (head.commit?.message ?? "").split("\n")[0] ?? "",
                url: head.html_url ?? `https://github.com/${repo}`,
                at: head.commit?.author?.date ?? new Date().toISOString(),
                author: head.commit?.author?.name ?? "unknown",
              }
            : undefined,
          failedRuns: runs.filter((r) => r.conclusion === "failure").slice(0, 5),
          recentRuns: runs.slice(0, 5),
        };
      } catch (error) {
        return {
          repo,
          openIssues: 0,
          openPullRequests: 0,
          failedRuns: [],
          recentRuns: [],
          error: error instanceof Error ? error.message : "request failed",
        };
      }
    }),
  );

  const allFailed = summaries.every((s) => s.error);
  return {
    configured: true,
    ok: !allFailed,
    repos: summaries,
    assigned: assignedResult.items,
    ...(assignedResult.error ? { assignedError: assignedResult.error } : {}),
    fetchedAt: new Date().toISOString(),
    ...(allFailed ? { error: summaries[0]?.error ?? "All repository requests failed" } : {}),
  };
}

function toRun(raw: Record<string, unknown>): GithubWorkflowRun {
  const id = Number(raw["id"] ?? 0);
  const repoUrl = String(raw["html_url"] ?? "");
  return {
    id,
    name: String(raw["name"] ?? raw["display_title"] ?? "workflow"),
    status: String(raw["status"] ?? "unknown"),
    conclusion: raw["conclusion"] === null ? null : String(raw["conclusion"] ?? ""),
    branch: String(raw["head_branch"] ?? "—"),
    url: repoUrl,
    logsUrl: repoUrl,
    updatedAt: String(raw["updated_at"] ?? new Date().toISOString()),
  };
}

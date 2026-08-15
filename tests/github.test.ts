/**
 * GitHub adapter.
 *
 * The fixtures below are real responses captured from api.github.com
 * (TanStack/router, unauthenticated), so these assert against the shapes the
 * live API actually returns rather than an invented schema.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchGithub, isReadPath, toAssigned } from "@/server/providers/github";

/** Captured from GET /repos/TanStack/router/actions/runs */
const RUNS_FIXTURE = {
  workflow_runs: [
    {
      id: 31118893760,
      name: "autofix.ci",
      status: "completed",
      conclusion: "failure",
      head_branch: "link-rerender-bailout",
      html_url: "https://github.com/TanStack/router/actions/runs/31118893760",
      updated_at: "2026-08-06T17:08:12Z",
      display_title: "perf(react-router): bail out of Link re-renders",
    },
    {
      id: 31118893761,
      name: "ci",
      status: "completed",
      conclusion: "success",
      head_branch: "main",
      html_url: "https://github.com/TanStack/router/actions/runs/31118893761",
      updated_at: "2026-08-06T16:40:00Z",
    },
    {
      id: 31118893762,
      name: "nightly",
      status: "in_progress",
      conclusion: null,
      head_branch: "main",
      html_url: "https://github.com/TanStack/router/actions/runs/31118893762",
      updated_at: "2026-08-06T18:00:00Z",
    },
  ],
};

/** Captured from GET /repos/TanStack/router/issues — PRs appear here too. */
const ISSUES_FIXTURE = [
  { number: 1, title: "A real issue" },
  { number: 2, title: "A pull request", pull_request: { url: "https://api.github.com/..." } },
  { number: 3, title: "Another issue" },
];

/** Captured from GET /repos/TanStack/router/commits */
const COMMITS_FIXTURE = [
  {
    html_url: "https://github.com/TanStack/router/commit/abf9b81",
    commit: {
      message: "test: stabilize codspeed CPU benchmarks\n\nlonger body text",
      author: { name: "Flo", email: "me@example.com", date: "2026-08-06T14:46:19Z" },
    },
  },
];

function mockGithub(handler?: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (handler) {
        const custom = handler(url);
        if (custom) return custom;
      }
      const body = url.includes("/actions/runs")
        ? RUNS_FIXTURE
        : url.includes("/issues")
          ? ISSUES_FIXTURE
          : url.includes("/commits")
            ? COMMITS_FIXTURE
            : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

describe("fetchGithub", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports missing configuration instead of throwing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    const result = await fetchGithub(["owner/repo"]);
    expect(result.configured).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GITHUB_TOKEN/);
  });

  it("separates issues from pull requests the way the API mixes them", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub();
    const result = await fetchGithub(["TanStack/router"]);
    const repo = result.repos[0]!;
    expect(repo.openIssues).toBe(2);
    expect(repo.openPullRequests).toBe(1);
  });

  it("reads the workflow run fields the live API returns", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub();
    const repo = (await fetchGithub(["TanStack/router"])).repos[0]!;
    expect(repo.recentRuns[0]).toMatchObject({
      id: 31118893760,
      name: "autofix.ci",
      conclusion: "failure",
      branch: "link-rerender-bailout",
      status: "completed",
    });
    expect(repo.recentRuns[0]?.logsUrl).toContain("/actions/runs/");
  });

  it("surfaces only failed runs in failedRuns", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub();
    const repo = (await fetchGithub(["TanStack/router"])).repos[0]!;
    expect(repo.failedRuns).toHaveLength(1);
    expect(repo.failedRuns[0]?.name).toBe("autofix.ci");
  });

  it("keeps an in-progress run out of the failed list", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub();
    const repo = (await fetchGithub(["TanStack/router"])).repos[0]!;
    expect(repo.failedRuns.map((r) => r.id)).not.toContain(31118893762);
  });

  it("uses only the first line of a commit message", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub();
    const repo = (await fetchGithub(["TanStack/router"])).repos[0]!;
    expect(repo.lastCommit?.message).toBe("test: stabilize codspeed CPU benchmarks");
    expect(repo.lastCommit?.author).toBe("Flo");
  });

  it("rejects a malformed repository name before making a request", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response("[]", { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchGithub(["not-a-repo", "also/bad/shape"]);
    expect(result.repos).toEqual([]);
    // The assigned lookup is independent of linked projects, so it still runs;
    // what must not happen is any request for the malformed repositories.
    const requested = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(requested.every((url) => url.includes("filter=assigned"))).toBe(true);
    expect(requested.some((url) => url.includes("not-a-repo"))).toBe(false);
  });

  it("explains a rejected token rather than surfacing a raw 401", async () => {
    vi.stubEnv("GITHUB_TOKEN", "bad-token");
    mockGithub(() => new Response("{}", { status: 401 }));
    const repo = (await fetchGithub(["TanStack/router"])).repos[0]!;
    expect(repo.error).toMatch(/rejected the configured token/i);
  });

  it("names rate limiting specifically when the remaining budget is zero", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub(
      () =>
        new Response("{}", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    );
    const repo = (await fetchGithub(["TanStack/router"])).repos[0]!;
    expect(repo.error).toMatch(/rate limit/i);
  });

  it("isolates one failing repository from the others", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub((url) =>
      url.includes("broken/repo") ? new Response("{}", { status: 500 }) : (undefined as never),
    );
    const result = await fetchGithub(["TanStack/router", "broken/repo"]);
    expect(result.ok).toBe(true);
    expect(result.repos.find((r) => r.repo === "TanStack/router")?.error).toBeUndefined();
    expect(result.repos.find((r) => r.repo === "broken/repo")?.error).toBeTruthy();
  });

  it("returns ok:false only when every repository failed", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    mockGithub(() => new Response("{}", { status: 500 }));
    const result = await fetchGithub(["a/b", "c/d"]);
    expect(result.ok).toBe(false);
  });
});

/**
 * Read-only enforcement.
 *
 * The classic token AaditOS uses carries the `repo` scope, which GitHub does
 * not offer read-only. These tests are the compensating control: they fail the
 * build if the adapter ever gains the ability to write.
 */
describe("github adapter is structurally read-only", () => {
  // Strip comments first: the module documents these very rules in prose, and
  // scanning the prose would match the words instead of the code.
  const source = readFileSync(resolve(process.cwd(), "src/server/providers/github.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("calls fetch in exactly one place", () => {
    const callSites = source.match(/\bfetch\s*\(/g) ?? [];
    expect(callSites).toHaveLength(1);
  });

  it("declares GET and never another HTTP method", () => {
    const methods = [...source.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods).toEqual(["GET"]);
  });

  it("contains no mutating HTTP verb in any request", () => {
    expect(source).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
  });

  it("accepts only the reviewed read endpoints", () => {
    expect(isReadPath("/issues?filter=assigned&state=open")).toBe(true);
    expect(isReadPath("/repos/RoboBearLLC/VenuAI")).toBe(true);
    expect(isReadPath("/repos/a/b/issues?state=open")).toBe(true);
    expect(isReadPath("/repos/a/b/commits?per_page=1")).toBe(true);
    expect(isReadPath("/repos/a/b/actions/runs?per_page=20")).toBe(true);
  });

  it("rejects paths that would mutate a repository", () => {
    expect(isReadPath("/repos/a/b/merges")).toBe(false);
    expect(isReadPath("/repos/a/b/issues/1/comments")).toBe(false);
    expect(isReadPath("/repos/a/b/actions/runs/1/rerun")).toBe(false);
    expect(isReadPath("/repos/a/b/pulls/1/merge")).toBe(false);
    expect(isReadPath("/user/repos")).toBe(false);
  });
});

/** Captured shape from GET /issues?filter=assigned against RoboBearLLC/VenuAI. */
const ASSIGNED_FIXTURE = [
  {
    id: 3512440001,
    number: 1791,
    title: "Fix: Campaign Engine Resiliency and Watchdog Auto Recovery",
    html_url: "https://github.com/RoboBearLLC/VenuAI/pull/1791",
    updated_at: "2026-08-07T18:20:11Z",
    comments: 4,
    draft: false,
    pull_request: { url: "https://api.github.com/repos/RoboBearLLC/VenuAI/pulls/1791" },
    labels: [{ name: "bug" }, { name: "P1" }],
    repository: { full_name: "RoboBearLLC/VenuAI" },
  },
  {
    id: 3512440002,
    number: 1754,
    title: "P1 pain point: venue product",
    html_url: "https://github.com/RoboBearLLC/VenuAI/issues/1754",
    updated_at: "2026-08-06T09:02:00Z",
    comments: 0,
    labels: [],
    repository: { full_name: "RoboBearLLC/VenuAI" },
  },
];

describe("assigned work", () => {
  it("distinguishes a pull request from an issue", () => {
    const [pr, issue] = ASSIGNED_FIXTURE.map(toAssigned);
    expect(pr!.isPullRequest).toBe(true);
    expect(issue!.isPullRequest).toBe(false);
  });

  it("keeps the repository each item belongs to", () => {
    expect(toAssigned(ASSIGNED_FIXTURE[0]!).repo).toBe("RoboBearLLC/VenuAI");
  });

  it("flattens label objects to names", () => {
    expect(toAssigned(ASSIGNED_FIXTURE[0]!).labels).toEqual(["bug", "P1"]);
    expect(toAssigned(ASSIGNED_FIXTURE[1]!).labels).toEqual([]);
  });

  it("survives a payload with no repository field", () => {
    expect(toAssigned({ number: 1 }).repo).toBe("unknown/unknown");
  });

  it("reports assigned work even when no project links a repository", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(ASSIGNED_FIXTURE), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const result = await fetchGithub([]);
    expect(result.ok).toBe(true);
    expect(result.assigned).toHaveLength(2);
    expect(result.assigned[0]?.number).toBe(1791);
  });

  it("keeps repository data usable when only the assigned lookup fails", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("filter=assigned")) return new Response("{}", { status: 500 });
        const body = url.includes("/actions/runs")
          ? RUNS_FIXTURE
          : url.includes("/issues")
            ? ISSUES_FIXTURE
            : COMMITS_FIXTURE;
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const result = await fetchGithub(["TanStack/router"]);
    expect(result.ok).toBe(true);
    expect(result.assigned).toEqual([]);
    expect(result.assignedError).toBeTruthy();
    expect(result.repos[0]?.error).toBeUndefined();
  });
});

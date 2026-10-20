/**
 * GitHub adapter — what is waiting on you.
 *
 * A fine-grained personal access token with read access to issues and pull
 * requests. Three searches, each read-only: issues assigned to you, pull
 * requests waiting for your review, and your own open pull requests. Each
 * becomes an Inbox item; one click files it through capture.
 */

import type { InboxItem } from "@/lib/integrations/contracts";

import { serverEnv } from "../env";

const API = "https://api.github.com";

export function githubConfigured(): boolean {
  return Boolean(serverEnv.githubToken);
}

interface SearchRow {
  id?: number;
  number?: number;
  title?: string;
  html_url?: string;
  updated_at?: string;
  body?: string | null;
  repository_url?: string;
  user?: { login?: string } | null;
  pull_request?: unknown;
}

/** Pure: GitHub search rows → inbox items. Exported for tests. */
export function normalizeGithubItems(rows: unknown, why: string): InboxItem[] {
  if (!Array.isArray(rows)) return [];
  const out: InboxItem[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as SearchRow;
    const title = row.title?.trim();
    if (!title || !row.id) continue;
    const repo = row.repository_url?.split("/repos/")[1] ?? "";
    const kind = row.pull_request ? "PR" : "Issue";
    const body = (row.body ?? "").replace(/\s+/g, " ").trim();
    out.push({
      id: `github:${row.id}`,
      source: "github",
      title: `${kind} ${row.number ? `#${row.number} ` : ""}${title}`,
      detail: [why, repo, body ? body.slice(0, 160) : ""].filter(Boolean).join(" · "),
      from: row.user?.login ?? undefined,
      url: row.html_url,
      at: row.updated_at ?? new Date().toISOString(),
    });
  }
  return out;
}

async function search(query: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(
    `${API}/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=20`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "AaditOS/1.0",
      },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (response.status === 401) throw new Error("GitHub rejected the token. Generate a new one.");
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error("GitHub rate limit reached; it resets within the hour.");
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const data = (await response.json()) as { items?: unknown };
  return data.items;
}

export interface GithubResult {
  configured: boolean;
  ok: boolean;
  items: InboxItem[];
  error?: string;
}

export async function fetchGithub(fetchImpl: typeof fetch = fetch): Promise<GithubResult> {
  const token = serverEnv.githubToken;
  if (!token) {
    return { configured: false, ok: false, items: [], error: "GITHUB_TOKEN is not set." };
  }

  const queries: Array<[string, string]> = [
    ["is:open assignee:@me", "Assigned to you"],
    ["is:open is:pr review-requested:@me", "Review requested"],
    ["is:open is:pr author:@me", "Your open PR"],
  ];

  const results = await Promise.allSettled(
    queries.map(async ([q, why]) => normalizeGithubItems(await search(q, token, fetchImpl), why)),
  );

  const items = new Map<string, InboxItem>();
  const problems: string[] = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      for (const item of result.value) if (!items.has(item.id)) items.set(item.id, item);
    } else {
      problems.push(result.reason instanceof Error ? result.reason.message : "request failed");
    }
  });

  return {
    configured: true,
    ok: problems.length < queries.length,
    items: [...items.values()].sort((a, b) => b.at.localeCompare(a.at)),
    ...(problems.length > 0 ? { error: [...new Set(problems)].join(" · ") } : {}),
  };
}

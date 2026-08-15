/** Vercel adapter — read-only deployment status. */

import type { VercelDeployment, VercelResult } from "@/lib/integrations/contracts";

import { serverEnv } from "../env";

export type { VercelDeployment, VercelResult };

const API = "https://api.vercel.com";

function withTeam(path: string): string {
  const team = serverEnv.vercelTeamId;
  if (!team) return path;
  return path.includes("?") ? `${path}&teamId=${team}` : `${path}?teamId=${team}`;
}

async function vercel<T>(path: string): Promise<T> {
  const token = serverEnv.vercelToken;
  if (!token) throw new Error("VERCEL_TOKEN is not configured");
  const response = await fetch(`${API}${withTeam(path)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Vercel rejected the configured token");
  }
  if (!response.ok) throw new Error(`Vercel returned ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchVercel(): Promise<VercelResult> {
  if (!serverEnv.vercelToken) {
    return {
      configured: false,
      ok: false,
      deployments: [],
      projects: [],
      error: "VERCEL_TOKEN is not set",
    };
  }
  try {
    const [deploymentsPayload, projectsPayload] = await Promise.all([
      vercel<{ deployments?: Array<Record<string, unknown>> }>("/v6/deployments?limit=20"),
      vercel<{ projects?: Array<Record<string, unknown>> }>("/v9/projects?limit=20"),
    ]);

    return {
      configured: true,
      ok: true,
      fetchedAt: new Date().toISOString(),
      projects: (projectsPayload.projects ?? []).map((p) => ({
        name: String(p["name"] ?? ""),
        framework: p["framework"] ? String(p["framework"]) : undefined,
      })),
      deployments: (deploymentsPayload.deployments ?? []).map((d): VercelDeployment => {
        const meta = (d["meta"] ?? {}) as Record<string, unknown>;
        return {
          id: String(d["uid"] ?? d["id"] ?? ""),
          project: String(d["name"] ?? "—"),
          state: String(d["state"] ?? d["readyState"] ?? "UNKNOWN"),
          target: String(d["target"] ?? "preview"),
          url: d["url"] ? `https://${String(d["url"])}` : "",
          branch: meta["githubCommitRef"] ? String(meta["githubCommitRef"]) : undefined,
          framework: d["framework"] ? String(d["framework"]) : undefined,
          createdAt: new Date(Number(d["createdAt"] ?? Date.now())).toISOString(),
        };
      }),
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      deployments: [],
      projects: [],
      error: error instanceof Error ? error.message : "Vercel request failed",
    };
  }
}

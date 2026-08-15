import { createFileRoute } from "@tanstack/react-router";

import type { NotificationCategory, Task, Workspace } from "@/lib/core/types";
import { pendingAlerts } from "@/lib/notify/engine";
import { serverEnv } from "@/server/env";
import { readPushSession } from "@/server/push-session";

/**
 * The content behind a payload-less push.
 *
 * The service worker calls this the moment a push arrives and shows whatever
 * comes back. Keeping the text here rather than in the push itself means the
 * push service never sees it, and there is no payload to encrypt.
 *
 * The same `pendingAlerts` engine the in-app notifier uses decides what to say,
 * so a push and an in-app alert can never disagree about what is urgent.
 */
export const Route = createFileRoute("/api/push/next")({
  server: {
    handlers: {
      GET: async () => {
        const session = await readPushSession();
        if (!session.userId) {
          // Not an error: the worker falls back to a generic notification.
          return json({ ok: false, reason: "no-session" }, 200);
        }

        const url = serverEnv.supabaseUrl;
        const key = serverEnv.supabaseServiceRoleKey;
        if (!url || !key) return json({ ok: false, reason: "not-configured" }, 200);

        try {
          // Only open, dated work can produce an alert, so only that is fetched.
          const response = await fetch(
            `${url}/rest/v1/tasks?user_id=eq.${session.userId}` +
              `&status=in.(todo,in_progress)&due_at=not.is.null` +
              `&select=id,title,due_at,due_all_day,priority,category,status&order=due_at.asc&limit=50`,
            {
              headers: { apikey: key, authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(8_000),
            },
          );
          if (!response.ok) return json({ ok: false, reason: "query-failed" }, 200);

          const rows = (await response.json()) as Array<Record<string, unknown>>;
          const tasks = rows.map(
            (row) =>
              ({
                id: String(row["id"]),
                userId: session.userId,
                title: String(row["title"] ?? "Untitled"),
                dueAt: (row["due_at"] as string) ?? undefined,
                dueAllDay: Boolean(row["due_all_day"]),
                priority: (row["priority"] as Task["priority"]) ?? "normal",
                category: (row["category"] as Task["category"]) ?? "personal",
                status: (row["status"] as Task["status"]) ?? "todo",
                estimateMin: 30,
                source: "manual",
                subtasks: [],
                position: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }) as Task,
          );

          // Only the task rules can fire here: notifications, sync runs and
          // integrations are not loaded, and an empty list simply yields none.
          const workspace = {
            tasks,
            notifications: [],
            syncRuns: [],
            integrations: [],
          } as unknown as Workspace;

          const alerts = pendingAlerts(workspace, {
            now: new Date(),
            delivered: new Set<string>(),
            muted: new Set<NotificationCategory>(),
          });

          const alert = alerts[0];
          if (!alert) return json({ ok: false, reason: "nothing-pending" }, 200);

          return json({ ok: true, ...alert }, 200);
        } catch {
          return json({ ok: false, reason: "error" }, 200);
        }
      },
    },
  },
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

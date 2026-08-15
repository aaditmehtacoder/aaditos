/**
 * What deserves to interrupt you.
 *
 * A notification is the most expensive thing this app can do: it pulls the user
 * out of whatever they are doing, on a device they may not even be looking at.
 * So the rules here are deliberately narrow, and every alert is keyed by the
 * *state* that justified it — not by the task id. A task that is due soon and
 * then goes overdue is two different facts and earns two alerts; a task that is
 * still due soon on the next tick earns nothing.
 *
 * This module is pure. It decides; `use-notifier.ts` delivers.
 */

import type {
  AppNotification,
  IntegrationStatus,
  NotificationCategory,
  SyncRun,
  Task,
  Workspace,
} from "@/lib/core/types";
import { PROVIDER_INTEGRATION_IDS, type SyncProvider } from "@/lib/integrations/contracts";

export interface Alert {
  /** Stable per (thing, state). Delivered at most once, ever. */
  key: string;
  title: string;
  body: string;
  category: NotificationCategory;
  /** In-app route to open when the alert is clicked. */
  href: string;
}

export interface AlertOptions {
  now: Date;
  /** Keys already delivered. Anything in here is skipped. */
  delivered: ReadonlySet<string>;
  /** Categories the user has muted. */
  muted: ReadonlySet<NotificationCategory>;
  /** How far ahead a deadline counts as "due soon". Default 60 minutes. */
  leadMinutes?: number;
}

const DEFAULT_LEAD_MIN = 60;

/**
 * Overdue work is only worth mentioning while it is still actionable. A task
 * three weeks late is a fact about the past, and waking someone for it is noise.
 */
const OVERDUE_GRACE_HOURS = 48;

export function pendingAlerts(workspace: Workspace, opts: AlertOptions): Alert[] {
  const lead = opts.leadMinutes ?? DEFAULT_LEAD_MIN;
  const alerts: Alert[] = [];

  const push = (alert: Alert) => {
    if (opts.muted.has(alert.category)) return;
    if (opts.delivered.has(alert.key)) return;
    alerts.push(alert);
  };

  for (const task of workspace.tasks) {
    for (const alert of taskAlerts(task, opts.now, lead)) push(alert);
  }

  for (const notification of workspace.notifications) {
    const alert = notificationAlert(notification, opts.now);
    if (alert) push(alert);
  }

  const statusFor = (provider: string) => {
    const id = PROVIDER_INTEGRATION_IDS[provider as SyncProvider] ?? provider;
    return workspace.integrations.find((i) => i.id === id)?.status;
  };
  for (const run of workspace.syncRuns) {
    const alert = syncAlert(run, opts.now, statusFor);
    if (alert) push(alert);
  }

  // Soonest deadline first: if several fire at once, the most urgent is the one
  // still on screen after the others are dismissed.
  return alerts;
}

function taskAlerts(task: Task, now: Date, leadMinutes: number): Alert[] {
  if (task.status === "done" || task.status === "archived") return [];
  if (!task.dueAt) return [];

  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return [];

  const minutesAway = (due.getTime() - now.getTime()) / 60_000;
  const category: NotificationCategory = task.category === "school" ? "school" : "projects";
  const href = "/tasks";

  // Overdue, but only inside the grace window.
  if (minutesAway < 0) {
    const hoursLate = -minutesAway / 60;
    if (hoursLate > OVERDUE_GRACE_HOURS) return [];
    return [
      {
        key: `task:${task.id}:overdue`,
        title: "Overdue",
        body: `${task.title} was due ${formatLate(-minutesAway)} ago.`,
        category: "urgent",
        href,
      },
    ];
  }

  if (minutesAway <= leadMinutes) {
    return [
      {
        key: `task:${task.id}:due-soon`,
        title: task.priority === "urgent" ? "Due soon · urgent" : "Due soon",
        body: `${task.title} is due in ${formatLate(minutesAway)}.`,
        category,
        href,
      },
    ];
  }

  return [];
}

/**
 * An unread urgent notification is already a considered judgement by the rest of
 * the app, so it is passed through rather than re-derived. Anything quieter than
 * urgent stays in-app.
 */
function notificationAlert(notification: AppNotification, now: Date): Alert | null {
  if (notification.read) return null;
  if (notification.category !== "urgent") return null;

  // Skip anything that predates this session by a lot; on first install the
  // whole backlog would otherwise arrive at once.
  const age = now.getTime() - new Date(notification.createdAt).getTime();
  if (!Number.isFinite(age) || age > 24 * 3_600_000) return null;

  return {
    key: `notification:${notification.dedupeKey}`,
    title: notification.title,
    body: notification.detail ?? "Open AaditOS for details.",
    category: "urgent",
    href: notification.href ?? "/notifications",
  };
}

/**
 * A provider that was never configured reports `ok: false` on every single run.
 * That is a settings state, not a failure, and a daily "Spotify credentials are
 * not set" would train the user to ignore the channel entirely.
 *
 * `SyncRun` does not persist the `needsCredentials` flag, but the integration
 * record does — the sync layer writes `status: "unavailable"` for exactly this
 * case. Reading that is structural; matching on the wording of the message is
 * not, and would break the first time an error string is reworded.
 */
function syncAlert(
  run: SyncRun,
  now: Date,
  statusFor: (provider: string) => IntegrationStatus | undefined,
): Alert | null {
  if (run.ok) return null;
  if (statusFor(run.provider) === "unavailable") return null;

  const age = now.getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(age) || age > 6 * 3_600_000) return null;

  return {
    key: `sync:${run.provider}:${run.startedAt}`,
    title: `${run.provider} sync failed`,
    body: run.message || "Open Integrations to see what went wrong.",
    category: "system",
    href: "/integrations",
  };
}

/** "45m", "2h", "3d" — short enough for a notification body. */
export function formatLate(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const hours = Math.round(m / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

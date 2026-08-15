import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, BellOff, Check, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  Panel,
  PanelHeader,
  Pill,
  RowSkeleton,
  Segmented,
  SourceTag,
} from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { relativeTimeLabel } from "@/lib/core/time";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/core/types";
import {
  pushStatus,
  subscribeToPush,
  unsubscribeFromPush,
  type PushAvailability,
} from "@/lib/notify/push-client";
import { forgetDelivered, showAlert } from "@/lib/notify/use-notifier";
import { useAuth } from "@/lib/auth/context";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications · AaditOS" },
      { name: "description", content: "Due-soon reminders, sync failures and follow-ups." },
    ],
  }),
  component: NotificationsPage,
});

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  urgent: "Urgent",
  school: "School",
  projects: "Projects",
  opportunities: "Opportunities",
  system: "System",
};

const CATEGORY_TONE: Record<NotificationCategory, "urgent" | "primary" | "neutral" | "warning"> = {
  urgent: "urgent",
  school: "primary",
  projects: "neutral",
  opportunities: "neutral",
  system: "warning",
};

type Permission = "default" | "granted" | "denied" | "unsupported";

const APP_ROUTES = [
  "/",
  "/school",
  "/tasks",
  "/projects",
  "/opportunities",
  "/focus",
  "/compass",
  "/notifications",
  "/integrations",
  "/settings",
];

/**
 * Notifications can be created by a sync, so their `href` is data. Only render
 * a link when it points at a route that exists — a bad link is a dead control.
 */
function isKnownRoute(href: string): boolean {
  return APP_ROUTES.includes(href) || /^\/projects\/[\w-]+$/.test(href);
}

function NotificationsPage() {
  const {
    workspace,
    status,
    markNotificationRead,
    markAllNotificationsRead,
    toggleMutedCategory,
    savePreferences,
  } = useOS();
  const [filter, setFilter] = useState<string>("all");
  const [permission, setPermission] = useState<Permission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission as Permission;
  });

  const { session } = useAuth();
  const [push, setPush] = useState<PushAvailability | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushStatus().then((s) => live && setPush(s));
    return () => {
      live = false;
    };
  }, [permission]);

  /**
   * Push is what makes an alert arrive when the app is closed. It is offered
   * only after permission is granted, because subscribing without permission
   * produces a subscription that can never show anything.
   */
  async function togglePush(on: boolean) {
    setPushBusy(true);
    const result = on
      ? await subscribeToPush(session?.accessToken)
      : await unsubscribeFromPush(session?.accessToken);
    setPushBusy(false);
    if (result.ok) {
      setPush(await pushStatus());
      toast.success(on ? "This device will get alerts when closed" : "Background alerts off");
    } else {
      toast.error(on ? "Could not enable background alerts" : "Could not turn them off", {
        description: result.message,
      });
    }
  }

  const muted = new Set(workspace.preferences.mutedNotificationCategories);

  const filtered = useMemo(() => {
    const list = workspace.notifications.filter((n) => !muted.has(n.category));
    if (filter === "all") return list;
    if (filter === "unread") return list.filter((n) => !n.read);
    return list.filter((n) => n.category === filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.notifications, workspace.preferences.mutedNotificationCategories, filter]);

  const unread = workspace.notifications.filter((n) => !n.read && !muted.has(n.category)).length;

  /**
   * Deliberately goes through `showAlert`, the same path real alerts take. A
   * test that used a different mechanism could pass while delivery is broken.
   */
  async function sendTest() {
    const shown = await showAlert({
      key: `test:${Date.now()}`,
      title: "AaditOS notifications are on",
      body: "This is what a due-soon reminder will look like.",
      category: "system",
      href: "/notifications",
    });
    if (!shown) {
      toast.error("Could not show the notification", {
        description: "Check this site's notification permission in your browser settings.",
      });
    }
  }

  async function requestPermission() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    // Requested only from this explicit click — never on page load.
    const result = await Notification.requestPermission();
    setPermission(result as Permission);
    if (result === "granted") {
      await savePreferences({ browserNotifications: true });
      await sendTest();
    } else {
      await savePreferences({ browserNotifications: false });
      toast.message("Browser notifications were not enabled", {
        description: "You can change this in your browser's site settings.",
      });
    }
  }

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="display text-[23px]">Notifications</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {unread} unread · {workspace.notifications.length} total
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[12.5px]"
          disabled={unread === 0}
          onClick={() => void markAllNotificationsRead()}
        >
          <Check className="size-3.5" aria-hidden /> Mark all read
        </Button>
      </div>

      <div className="pb-4">
        <Segmented
          label="Notification filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: workspace.notifications.length },
            { value: "unread", label: "Unread", count: unread },
            ...NOTIFICATION_CATEGORIES.map((c) => ({
              value: c,
              label: CATEGORY_LABEL[c],
              count: workspace.notifications.filter((n) => n.category === c).length,
            })),
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Panel>
          <PanelHeader
            title={`${filtered.length} notification${filtered.length === 1 ? "" : "s"}`}
          />
          {status === "loading" ? (
            <RowSkeleton rows={5} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Nothing here"
              description="Due-soon reminders, failed syncs, GitHub workflow failures and follow-ups appear here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((notification) => (
                <li
                  key={notification.id}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/50",
                    !notification.read && "bg-primary-soft/25",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      notification.read ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[13px] font-medium">{notification.title}</p>
                      <Pill tone={CATEGORY_TONE[notification.category]}>
                        {CATEGORY_LABEL[notification.category]}
                      </Pill>
                      {!notification.read ? <span className="sr-only">Unread</span> : null}
                    </div>
                    {notification.detail ? (
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                        {notification.detail}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                      <span>{relativeTimeLabel(notification.createdAt)}</span>
                      <SourceTag source={notification.source} />
                      {notification.href && isKnownRoute(notification.href) ? (
                        <Link
                          to={notification.href}
                          className="-mx-1 inline-flex min-h-6 items-center rounded px-1 underline underline-offset-2 hover:text-foreground"
                        >
                          Open
                        </Link>
                      ) : null}
                      {notification.externalUrl ? (
                        <a
                          href={notification.externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                        >
                          Source <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 text-[11.5px]"
                    onClick={() => void markNotificationRead(notification.id, !notification.read)}
                  >
                    {notification.read ? "Unread" : "Read"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Mute categories" />
            <ul className="divide-y divide-border">
              {NOTIFICATION_CATEGORIES.map((category) => (
                <li key={category} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <label htmlFor={`mute-${category}`} className="text-[12.5px]">
                    {CATEGORY_LABEL[category]}
                  </label>
                  <Switch
                    id={`mute-${category}`}
                    checked={!muted.has(category)}
                    onCheckedChange={() => void toggleMutedCategory(category)}
                    aria-label={`Show ${CATEGORY_LABEL[category]} notifications`}
                  />
                </li>
              ))}
            </ul>
            <p className="px-4 py-3 text-[11.5px] text-muted-foreground">
              Muted categories are hidden everywhere, including the sidebar count.
            </p>
          </Panel>

          <Panel>
            <PanelHeader title="Browser notifications" />
            <div className="px-4 py-3">
              {permission === "unsupported" ? (
                <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                  <BellOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  This browser does not support notifications.
                </p>
              ) : permission === "granted" ? (
                <>
                  <p className="flex items-start gap-2 text-[12.5px] text-success-strong">
                    <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Enabled for this browser.
                  </p>
                  <p className="mt-2 text-[12.5px] text-muted-foreground">
                    Alerts fire for work due in the next hour, work that just went overdue, and
                    failed syncs. Each one is sent once.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-[12.5px]"
                      onClick={() => void sendTest()}
                    >
                      <Bell className="size-3.5" aria-hidden /> Send a test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-[12.5px] text-muted-foreground"
                      onClick={() => {
                        forgetDelivered();
                        toast.success("Alert history cleared", {
                          description: "Anything still due will be announced again.",
                        });
                      }}
                    >
                      Reset alert history
                    </Button>
                  </div>

                  {push?.supported && push.configured ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium">
                            Alerts while AaditOS is closed
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            Without this, alerts only arrive while the app is open. Turn it on once
                            per device — your Chromebook and your laptop each need it.
                          </p>
                        </div>
                        <Switch
                          checked={push.subscribed}
                          disabled={pushBusy}
                          aria-label="Alerts while AaditOS is closed"
                          onCheckedChange={(checked) => void togglePush(checked)}
                        />
                      </div>
                    </div>
                  ) : push?.supported && !push.configured ? (
                    <p className="mt-4 border-t border-border pt-3 text-[12px] text-muted-foreground">
                      Alerts while the app is closed need VAPID keys on the server. Run{" "}
                      <code className="rounded bg-secondary px-1 text-[11px]">
                        node scripts/generate-vapid-keys.mjs
                      </code>
                      .
                    </p>
                  ) : null}
                </>
              ) : permission === "denied" ? (
                <p className="text-[12.5px] text-muted-foreground">
                  Blocked in your browser settings. Re-enable notifications for this site there,
                  then reload.
                </p>
              ) : (
                <>
                  <p className="text-[12.5px] text-muted-foreground">
                    Get desktop alerts for due-soon work and failed syncs. Permission is only
                    requested when you press this button.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3 h-8 gap-1.5 text-[12.5px]"
                    onClick={() => void requestPermission()}
                  >
                    <Bell className="size-3.5" aria-hidden /> Enable notifications
                  </Button>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

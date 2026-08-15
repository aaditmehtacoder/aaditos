/**
 * Delivery.
 *
 * `engine.ts` decides what deserves an alert; this fires it and remembers that
 * it did. Two things matter here:
 *
 *   - Notifications go through the **service worker registration**, not
 *     `new Notification()`. On an installed PWA — which is how this runs on a
 *     Chromebook — the constructor is unavailable or throws, while
 *     `registration.showNotification` works in both cases and gives the alert a
 *     click target that focuses the existing window instead of opening a
 *     duplicate tab.
 *
 *   - Delivered keys persist in localStorage. Without that, every reload would
 *     re-announce the same overdue task, which is the fastest way to make
 *     someone turn notifications off for good.
 */

import { useEffect, useRef } from "react";

import type { NotificationCategory } from "@/lib/core/types";
import { useOS } from "@/lib/store";

import { pendingAlerts, type Alert } from "./engine";

const STORE_KEY = "aaditos:delivered-alerts";
/** Keys older than this are forgotten, so the store cannot grow without bound. */
const REMEMBER_MS = 7 * 24 * 3_600_000;
const CHECK_INTERVAL_MS = 60_000;
/** One burst should never be more than this; the rest wait for the next tick. */
const MAX_PER_TICK = 3;

type Delivered = Record<string, number>;

function readDelivered(): Delivered {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Delivered;
    const cutoff = Date.now() - REMEMBER_MS;
    return Object.fromEntries(Object.entries(parsed).filter(([, at]) => at > cutoff));
  } catch {
    return {};
  }
}

function writeDelivered(value: Delivered): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Private mode: alerts may repeat across reloads, which beats crashing.
  }
}

export async function showAlert(alert: Alert): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;

  const options: NotificationOptions = {
    body: alert.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Same tag replaces rather than stacks, so a re-fired alert never doubles.
    tag: alert.key,
    data: { href: alert.href },
  };

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(alert.title, options);
      return true;
    }
  } catch {
    // Fall through to the constructor below.
  }

  try {
    new Notification(alert.title, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Watches the workspace and fires alerts. Mounted once, near the app root.
 *
 * Deliberately does nothing until the user has both granted permission and left
 * the preference on — a notification nobody asked for is worse than none.
 */
export function useNotifier(): void {
  const { workspace, status } = useOS();
  // Read through a ref so the interval is created once rather than being torn
  // down and rebuilt on every workspace change.
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const enabled =
    status === "ready" &&
    workspace.preferences.browserNotifications &&
    typeof window !== "undefined" &&
    "Notification" in window;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      if (Notification.permission !== "granted") return;

      const current = workspaceRef.current;
      const delivered = readDelivered();

      const alerts = pendingAlerts(current, {
        now: new Date(),
        delivered: new Set(Object.keys(delivered)),
        muted: new Set<NotificationCategory>(current.preferences.mutedNotificationCategories),
      }).slice(0, MAX_PER_TICK);

      if (alerts.length === 0) return;

      const now = Date.now();
      for (const alert of alerts) {
        const shown = await showAlert(alert);
        // Only record it as delivered if it actually reached the screen —
        // otherwise a transient failure would silently suppress it forever.
        if (shown) delivered[alert.key] = now;
      }
      writeDelivered(delivered);
    }

    // A short delay on mount lets the workspace settle before the first check,
    // so a fresh sign-in does not fire the backlog mid-render.
    const first = window.setTimeout(() => void tick(), 5_000);
    const interval = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [enabled]);
}

/** Clears the delivered log. Exposed so "send a test" can re-fire a real alert. */
export function forgetDelivered(): void {
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Keeps the workspace fresh without anyone pressing anything.
 *
 * Sync used to be entirely manual, which meant the calendar quietly went stale
 * until you noticed and clicked. Now it runs on its own — but on a schedule
 * chosen to stay well inside every provider's limits rather than as often as
 * technically possible:
 *
 *   - once shortly after load, if the last sync is older than the interval
 *   - every 30 minutes while the tab is open
 *   - when the tab becomes visible again after being hidden a while
 *   - when the device comes back online
 *
 * Three rules keep it from becoming a hammer:
 *
 *   1. A sync is skipped entirely if one ran recently — reopening the app ten
 *      times in a minute triggers one sync, not ten.
 *   2. Only providers that need no interactive credential are synced
 *      automatically. Google is left out on purpose: it fails loudly when its
 *      consent has lapsed, and an automatic retry every 30 minutes would turn
 *      one expired token into a stream of identical errors.
 *   3. Nothing runs offline, and nothing runs while a sync is already going.
 *
 * The manual "Sync now" button still exists and still syncs everything,
 * including Google. This only removes the need to remember.
 */

import { useCallback, useEffect, useRef } from "react";

import type { SyncProvider } from "@/lib/integrations/contracts";
import { useSync } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";

/** Public data and server-side credentials only — nothing that can need consent. */
const AUTO_PROVIDERS: SyncProvider[] = ["wilcox", "weather", "github", "vercel", "spotify"];

const INTERVAL_MS = 30 * 60 * 1000;
/** Long enough that a quick tab switch does not trigger a fetch. */
const VISIBILITY_MIN_AGE_MS = 10 * 60 * 1000;
/** Lets the first paint finish before any network work starts. */
const STARTUP_DELAY_MS = 4_000;

export function AutoSync() {
  const { status, workspace, connection, syncing } = useOS();
  const { sync, running } = useSync();

  // Read live state through refs so the interval is installed once instead of
  // being rebuilt every time the workspace changes.
  const busyRef = useRef(false);
  busyRef.current = running || syncing;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const lastRunRef = useRef<string | undefined>(undefined);
  lastRunRef.current = workspace.syncRuns[0]?.finishedAt ?? workspace.syncRuns[0]?.startedAt;

  const maybeSync = useCallback(
    (minAgeMs: number) => {
      if (busyRef.current) return;
      if (connectionRef.current === "offline") return;

      const last = lastRunRef.current ? new Date(lastRunRef.current).getTime() : 0;
      // A missing or unparseable timestamp reads as "never synced", which is
      // exactly when a sync is most warranted.
      if (Number.isFinite(last) && last > 0 && Date.now() - last < minAgeMs) return;

      void sync(AUTO_PROVIDERS);
    },
    [sync],
  );

  useEffect(() => {
    if (status !== "ready") return;

    const startup = window.setTimeout(() => maybeSync(INTERVAL_MS), STARTUP_DELAY_MS);
    const interval = window.setInterval(() => maybeSync(INTERVAL_MS), INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") maybeSync(VISIBILITY_MIN_AGE_MS);
    };
    // Coming back online is the one case worth syncing immediately: whatever
    // failed while disconnected is still missing.
    const onOnline = () => maybeSync(0);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [status, maybeSync]);

  return null;
}

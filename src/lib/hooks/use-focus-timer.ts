/**
 * Focus timer.
 *
 * The running session is mirrored to `localStorage` on every state change, and
 * elapsed time is derived from wall-clock timestamps rather than tick counting.
 * A refresh, a closed laptop lid, or a crash therefore resumes with the correct
 * elapsed time instead of losing the session.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { newId } from "@/lib/core/ids";
import { nowISO } from "@/lib/core/time";
import type { FocusSession, TaskCategory } from "@/lib/core/types";
import { useOS } from "@/lib/store";

const ACTIVE_KEY = "aaditos:focus-active";

function readActive(): FocusSession | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FocusSession;
    if (parsed.status !== "running" && parsed.status !== "paused") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeActive(session: FocusSession | null): void {
  try {
    if (session) window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* storage unavailable — the timer still works for this page view */
  }
}

/** Elapsed seconds including the currently running leg. */
export function elapsedSeconds(session: FocusSession, now: number): number {
  if (session.status !== "running" || !session.resumedAt) return session.elapsedSec;
  const legMs = now - new Date(session.resumedAt).getTime();
  return session.elapsedSec + Math.max(0, Math.floor(legMs / 1000));
}

export interface FocusTimer {
  session: FocusSession | null;
  elapsedSec: number;
  start: (input: {
    taskId?: string | undefined;
    taskTitle: string;
    category: TaskCategory;
    plannedMin: number;
  }) => void;
  pause: () => void;
  resume: () => void;
  finish: (reflection?: string) => Promise<FocusSession | null>;
  cancel: () => Promise<void>;
  restored: boolean;
}

export function useFocusTimer(): FocusTimer {
  const { saveFocusSession, updateTask, workspace } = useOS();
  const [session, setSession] = useState<FocusSession | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [restored, setRestored] = useState(false);
  const tick = useRef<number | null>(null);

  useEffect(() => {
    const existing = readActive();
    if (existing) {
      setSession(existing);
      setElapsed(elapsedSeconds(existing, Date.now()));
      setRestored(true);
    }
  }, []);

  useEffect(() => {
    if (tick.current !== null) {
      window.clearInterval(tick.current);
      tick.current = null;
    }
    if (session?.status === "running") {
      setElapsed(elapsedSeconds(session, Date.now()));
      tick.current = window.setInterval(() => {
        setElapsed(elapsedSeconds(session, Date.now()));
      }, 1000);
    } else if (session) {
      setElapsed(session.elapsedSec);
    } else {
      setElapsed(0);
    }
    return () => {
      if (tick.current !== null) window.clearInterval(tick.current);
    };
  }, [session]);

  // Recompute immediately when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && session?.status === "running") {
        setElapsed(elapsedSeconds(session, Date.now()));
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [session]);

  const persist = useCallback((next: FocusSession | null) => {
    setSession(next);
    writeActive(next);
  }, []);

  const start = useCallback<FocusTimer["start"]>(
    (input) => {
      const now = nowISO();
      const next: FocusSession = {
        id: newId(),
        userId: workspace.profile.id,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        category: input.category,
        plannedMin: input.plannedMin,
        elapsedSec: 0,
        status: "running",
        startedAt: now,
        resumedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      persist(next);
      setRestored(false);
      if (input.taskId) void updateTask(input.taskId, { status: "in_progress" });
    },
    [persist, updateTask, workspace.profile.id],
  );

  const pause = useCallback(() => {
    setSession((current) => {
      if (!current || current.status !== "running") return current;
      const next: FocusSession = {
        ...current,
        elapsedSec: elapsedSeconds(current, Date.now()),
        status: "paused",
        resumedAt: undefined,
        updatedAt: nowISO(),
      };
      writeActive(next);
      return next;
    });
  }, []);

  const resume = useCallback(() => {
    setSession((current) => {
      if (!current || current.status !== "paused") return current;
      const next: FocusSession = {
        ...current,
        status: "running",
        resumedAt: nowISO(),
        updatedAt: nowISO(),
      };
      writeActive(next);
      return next;
    });
  }, []);

  const finish = useCallback<FocusTimer["finish"]>(
    async (reflection) => {
      if (!session) return null;
      const total = elapsedSeconds(session, Date.now());
      const completed: FocusSession = {
        ...session,
        elapsedSec: total,
        status: "completed",
        resumedAt: undefined,
        endedAt: nowISO(),
        reflection: reflection?.trim() || undefined,
        updatedAt: nowISO(),
      };
      persist(null);
      await saveFocusSession(completed);
      if (session.taskId) {
        const task = workspace.tasks.find((t) => t.id === session.taskId);
        await updateTask(session.taskId, {
          actualMin: (task?.actualMin ?? 0) + Math.round(total / 60),
        });
      }
      return completed;
    },
    [session, persist, saveFocusSession, updateTask, workspace.tasks],
  );

  const cancel = useCallback(async () => {
    if (!session) return;
    const total = elapsedSeconds(session, Date.now());
    persist(null);
    // Only record a cancelled session if it actually ran for a meaningful time.
    if (total >= 60) {
      await saveFocusSession({
        ...session,
        elapsedSec: total,
        status: "cancelled",
        resumedAt: undefined,
        endedAt: nowISO(),
        updatedAt: nowISO(),
      });
    }
  }, [session, persist, saveFocusSession]);

  return { session, elapsedSec: elapsed, start, pause, resume, finish, cancel, restored };
}

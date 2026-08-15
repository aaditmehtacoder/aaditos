/**
 * Shared Compass conversation state.
 *
 * Both the full `/compass` page and the floating dock drive the same streaming
 * turn loop through this hook, so the two surfaces can never drift apart in
 * how they handle tools, proposals, cancellation or errors.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { newId } from "@/lib/core/ids";
import { streamCompass } from "@/lib/compass/client";
import { buildSnapshot } from "@/lib/compass/snapshot";
import type {
  CompassEvent,
  CompassMessage,
  CompassProposal,
  CompassToolName,
} from "@/lib/compass/types";
import { useOS } from "@/lib/store";

/** Human label for each tool, shown while Compass is working. */
export const TOOL_LABEL: Record<CompassToolName, string> = {
  list_tasks: "Reading your tasks",
  get_task: "Opening a task",
  list_assignments: "Reading assignments",
  list_events: "Reading your calendar",
  list_projects: "Reading projects",
  get_project_status: "Checking project status",
  list_opportunities: "Reading opportunities",
  create_daily_plan: "Building a plan",
  find_schedule_conflicts: "Checking for conflicts",
  get_focus_summary: "Summarizing focus time",
  propose_task: "Drafting a task",
  update_task: "Drafting a change",
};

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: Array<{ name: CompassToolName; data?: unknown; done: boolean }>;
  proposals: CompassProposal[];
  error?: { message: string; code: string; retryable: boolean } | undefined;
  streaming: boolean;
}

export interface CompassChat {
  turns: Turn[];
  busy: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useCompassChat(): CompassChat {
  const { workspace, isDemo, now } = useOS();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const snapshot = useMemo(
    () => buildSnapshot(workspace, now, { isDemo }),
    [workspace, now, isDemo],
  );

  // Abort any in-flight turn if the surface unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns((prev) => prev.map((t) => (t.streaming ? { ...t, streaming: false } : t)));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns([]);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || busy) return;

      const assistantId = newId();
      setTurns((prev) => [
        ...prev,
        {
          id: newId(),
          role: "user",
          text: clean,
          tools: [],
          proposals: [],
          streaming: false,
        },
        {
          id: assistantId,
          role: "assistant",
          text: "",
          tools: [],
          proposals: [],
          streaming: true,
        },
      ]);
      setBusy(true);

      const history: CompassMessage[] = [
        ...turns
          .filter((t) => t.text.trim().length > 0)
          .map((t) => ({ role: t.role, content: t.text })),
        { role: "user" as const, content: clean },
      ];

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fn: (turn: Turn) => Turn) =>
        setTurns((prev) => prev.map((t) => (t.id === assistantId ? fn(t) : t)));

      await streamCompass({
        messages: history,
        snapshot,
        tone: workspace.preferences.compassTone,
        signal: controller.signal,
        onEvent: (event: CompassEvent) => {
          switch (event.type) {
            case "text":
              patch((t) => ({ ...t, text: t.text + event.delta }));
              break;
            case "tool":
              patch((t) => ({ ...t, tools: [...t.tools, { name: event.name, done: false }] }));
              break;
            case "tool_result":
              patch((t) => ({
                ...t,
                tools: t.tools.map((tool) =>
                  tool.name === event.name && !tool.done
                    ? { ...tool, data: event.data, done: true }
                    : tool,
                ),
              }));
              break;
            case "proposal":
              patch((t) => ({ ...t, proposals: [...t.proposals, event.proposal] }));
              break;
            case "error":
              patch((t) => ({
                ...t,
                streaming: false,
                error: { message: event.message, code: event.code, retryable: event.retryable },
              }));
              break;
            case "done":
              patch((t) => ({ ...t, streaming: false }));
              break;
            default:
              break;
          }
        },
      });

      patch((t) => ({ ...t, streaming: false }));
      setBusy(false);
      abortRef.current = null;
    },
    [busy, turns, snapshot, workspace.preferences.compassTone],
  );

  return { turns, busy, send, stop, reset };
}

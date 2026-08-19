/**
 * Client side of the integration system.
 *
 * `useProviderConfig` asks the server which providers are configured (booleans
 * only). `useSync` runs a sync, applies the normalized results through the
 * repository, and records one `SyncRun` per provider so the UI can show exactly
 * what happened, including partial failures.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { newId } from "@/lib/core/ids";
import { mergeBySourceRef, normalizeEvent } from "@/lib/core/normalize";
import type { CalendarEvent, IntegrationRecord, SyncRun } from "@/lib/core/types";
import { PROVIDER_INTEGRATION_IDS } from "@/lib/integrations/contracts";
import { useOS } from "@/lib/store";
import type {
  ProviderCapabilities,
  SyncPayload,
  SyncProvider,
  GoogleStatus,
  SyncRunResult,
  WeatherResult,
} from "@/lib/integrations/contracts";

export function useProviderConfig() {
  return useQuery<ProviderCapabilities>({
    queryKey: ["provider-config"],
    queryFn: async () => {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error(`Configuration check failed (${response.status})`);
      return (await response.json()) as ProviderCapabilities;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useWeather() {
  return useQuery<WeatherResult>({
    queryKey: ["weather"],
    queryFn: async () => {
      const response = await fetch("/api/weather");
      return (await response.json()) as WeatherResult;
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export const SYNC_PAYLOAD_KEY = ["sync-payload"] as const;

/**
 * The most recent sync result, shared across the whole app.
 *
 * Sync can be triggered from the top bar or from Settings; every consumer must
 * see the same payload, so it lives in the query cache rather than in the
 * calling component's state.
 */
export function useLastSyncPayload(): SyncPayload | null {
  const { data } = useQuery<SyncPayload | null>({
    queryKey: SYNC_PAYLOAD_KEY,
    queryFn: () => null,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
    initialData: null,
  });
  return data ?? null;
}

export function useGoogleStatus() {
  return useQuery<GoogleStatus>({
    queryKey: ["google-status"],
    queryFn: async () => {
      const response = await fetch("/api/google/status");
      if (!response.ok) throw new Error(`Google status failed (${response.status})`);
      return (await response.json()) as GoogleStatus;
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export interface SyncState {
  running: boolean;
  lastPayload: SyncPayload | null;
  error: string | null;
}

/** Replace rows that share a `sourceRef`, keep everything else untouched. */
export function useSync() {
  const {
    userId,
    applyIntegration,
    recordSyncRun,
    importEvents,
    importCourses,
    importAssignments,
    setSyncing,
  } = useOS();
  const queryClient = useQueryClient();
  const lastPayload = useLastSyncPayload();
  const [state, setState] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null,
  });

  const sync = useCallback(
    async (providers: SyncProvider[]): Promise<SyncPayload | null> => {
      setState({ running: true, error: null });
      setSyncing(true);
      try {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ providers, userId }),
        });

        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(detail.error ?? `Sync failed (${response.status})`);
        }

        const payload = (await response.json()) as SyncPayload;

        if (payload.wilcox && payload.wilcox.events.length > 0) {
          const events = payload.wilcox.events.map((e): CalendarEvent => ({ ...e, userId }));
          await importEvents(payload.wilcox.calendarIds, events);
        }

        if (payload.google?.ok && payload.google.connected) {
          const google = payload.google;
          if (google.events.length > 0) {
            const events = google.events.map((raw) => normalizeEvent(raw as never, { userId }));
            await importEvents(["google:primary"], events);
          }
          if (google.courses.length > 0) {
            await importCourses(google.courses.map((c) => ({ ...c, userId })));
          }
          if (google.assignments.length > 0) {
            await importAssignments(google.assignments.map((a) => ({ ...a, userId })));
          }
        }

        for (const run of payload.runs) {
          await applyRun(run);
        }

        queryClient.setQueryData(SYNC_PAYLOAD_KEY, payload);
        setState({ running: false, error: null });
        return payload;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed";
        setState({ running: false, error: message });
        toast.error("Sync failed", { description: message });
        return null;
      } finally {
        setSyncing(false);
      }

      async function applyRun(run: SyncRunResult): Promise<void> {
        const record: IntegrationRecord = {
          id: PROVIDER_INTEGRATION_IDS[run.provider],
          userId,
          status: run.needsCredentials ? "unavailable" : run.ok ? "connected" : "error",
          lastSyncAt: run.ok ? run.finishedAt : undefined,
          lastError: run.ok ? undefined : run.message,
          meta: { summary: run.message },
          updatedAt: run.finishedAt,
        };
        await applyIntegration(record);

        const syncRun: SyncRun = {
          id: newId(),
          userId,
          provider: run.provider,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          ok: run.ok,
          imported: run.imported,
          updated: run.updated,
          skipped: run.skipped,
          message: run.message,
        };
        await recordSyncRun(syncRun);
      }
    },
    [
      userId,
      importEvents,
      importCourses,
      importAssignments,
      applyIntegration,
      recordSyncRun,
      setSyncing,
      queryClient,
    ],
  );

  return { ...state, lastPayload, sync };
}

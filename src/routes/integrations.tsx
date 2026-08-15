import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, ExternalLink, Info, LogOut, Plug, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { EmptyState, Panel, PanelHeader, Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { relativeTimeLabel } from "@/lib/core/time";
import type { IntegrationStatus } from "@/lib/core/types";
import {
  AVAILABILITY_LABEL,
  PROVIDERS,
  statusLabel,
  statusTone,
  type ProviderDescriptor,
} from "@/lib/integrations/registry";
import { useGoogleStatus, useProviderConfig, useSync } from "@/lib/integrations/use-integrations";
import { ProviderLogo } from "@/components/os/provider-logo";
import { useOS } from "@/lib/store";
import { SYNCABLE } from "@/lib/integrations/contracts";
import type { ProviderCapabilities, SyncProvider } from "@/lib/integrations/contracts";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations · AaditOS" },
      { name: "description", content: "Connection status, permissions and synchronization." },
    ],
  }),
  component: IntegrationsPage,
});

/**
 * The single place that decides what an integration's badge says.
 * Status is derived from real evidence: server configuration plus the outcome
 * of the last actual request. Nothing is ever optimistically "connected".
 */
function deriveStatus(
  provider: ProviderDescriptor,
  capabilities: ProviderCapabilities | undefined,
  record:
    | { status: IntegrationStatus; lastSyncAt?: string | undefined; lastError?: string | undefined }
    | undefined,
): { status: IntegrationStatus; detail: string; label?: string } {
  if (provider.availability === "manual") {
    return { status: "unavailable", detail: provider.limitation ?? "Manual capture only." };
  }

  const configured = provider.capabilityKey
    ? Boolean(capabilities?.[provider.capabilityKey as keyof ProviderCapabilities])
    : true;

  if (!configured) {
    return {
      status: "disconnected",
      detail: provider.envVars.length
        ? `Set ${provider.envVars.join(", ")} on the server to enable this.`
        : "Not configured.",
    };
  }

  if (record?.status === "error") {
    return { status: "error", detail: record.lastError ?? "The last sync failed." };
  }
  if (record?.status === "connected" && record.lastSyncAt) {
    return { status: "connected", detail: `Last synced ${relativeTimeLabel(record.lastSyncAt)}.` };
  }
  if (provider.sync) {
    return {
      status: "disconnected",
      // Distinguish "needs nothing, just has not run" from "needs credentials".
      label: provider.envVars.length === 0 ? "Ready to sync" : "Not synced",
      detail:
        provider.envVars.length === 0
          ? "No credentials needed — press Sync to pull live data."
          : "Credentials are set, but this browser has not synced yet.",
    };
  }
  return { status: "connected", detail: "Configured on the server." };
}

function IntegrationsPage() {
  const { workspace, isDemo } = useOS();
  const config = useProviderConfig();
  const { sync, running, lastPayload } = useSync();

  const google = useGoogleStatus();

  // Surface the result of the consent round trip, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("google");
    if (!outcome) return;
    if (outcome === "connected") toast.success("Google connected");
    else
      toast.error("Google could not be connected", {
        description: params.get("message") ?? undefined,
      });
    void google.refetch();
    window.history.replaceState({}, "", "/integrations");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const records = useMemo(
    () => new Map(workspace.integrations.map((i) => [i.id, i])),
    [workspace.integrations],
  );

  const syncable = PROVIDERS.filter((p): p is ProviderDescriptor & { sync: SyncProvider } =>
    Boolean(p.sync),
  );

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-5">
        <div className="min-w-0">
          <h1 className="display text-[23px]">Integrations</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            What is connected, what needs credentials, and what a provider genuinely does not allow.
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[12.5px]"
          disabled={running}
          onClick={() => void sync([...SYNCABLE])}
        >
          <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
          Sync now
        </Button>
      </div>

      {isDemo ? (
        <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-primary/25 bg-primary-soft/40 px-3 py-2.5 text-[12.5px]">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <span>
            You are in demo mode. Sample data is labelled as demo everywhere. Syncing a provider
            below still makes a real request — public sources like the Wilcox calendar and weather
            work with no credentials at all.
          </span>
        </div>
      ) : null}

      {config.isError ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-[12px] border border-urgent/30 bg-urgent-soft px-3 py-2.5 text-[12.5px] text-urgent"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Could not read the server configuration. Statuses below may be incomplete.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const record = records.get(provider.id);
          let { status, detail, label } = deriveStatus(provider, config.data, record);

          // Google is the one provider whose connection lives in a server
          // cookie, so its real state comes from /api/google/status.
          if (provider.oauth === "google" && google.data) {
            if (!google.data.configured) {
              status = "disconnected";
              label = "Needs credentials";
              detail = "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.";
            } else if (!google.data.encryptionReady) {
              status = "error";
              label = "Blocked";
              detail =
                "TOKEN_ENCRYPTION_KEY must be at least 32 characters before a Google token can be stored.";
            } else if (google.data.connected && google.data.missingScopes?.length) {
              // Connected, but on an older consent. Everything it was granted
              // still works; the newer capabilities return 403 until reconnect.
              status = "error";
              label = "Reconnect needed";
              // "Press Connect again" is only true when consent can actually be
              // re-granted. A Family Link account diverts to a parent, and an
              // account missing from the OAuth test-user list is refused
              // outright — in both cases clicking achieves nothing, and saying
              // otherwise sends the user in a loop.
              detail = `Connected as ${google.data.email ?? "your Google account"}, but this consent is missing ${listPhrase(
                google.data.missingScopes.map(shortScope),
              )}. Press Reconnect to grant it — if Google shows "Choose a parent" the account is supervised and a parent has to approve, and if it says access is blocked the account needs adding as a test user in Google Cloud Console.`;
            } else if (google.data.connected) {
              status = "connected";
              label = "Connected";
              detail = google.data.email
                ? `Connected as ${google.data.email}.`
                : "Connected. Press Sync to import.";
            } else {
              status = "disconnected";
              label = "Ready to connect";
              detail = "Press Connect to grant read-only access.";
            }
          }

          // Sync is only offered when it can actually succeed: the provider
          // must be backed by a sync job, configured (or need no credentials),
          // and — for OAuth providers — already connected. A stale consent
          // still syncs everything it was granted, so it does not block here.
          const configured = provider.capabilityKey
            ? Boolean(config.data?.[provider.capabilityKey as keyof ProviderCapabilities])
            : true;
          const canSync =
            Boolean(provider.sync) &&
            status !== "unavailable" &&
            configured &&
            (provider.oauth !== "google" || Boolean(google.data?.connected));

          return (
            <Panel key={provider.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                >
                  <ProviderLogo id={provider.id} glyph={provider.glyph} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="truncate text-[13.5px] font-semibold tracking-tight">
                      {provider.name}
                    </h2>
                    <Pill tone={statusTone(status)}>{label ?? statusLabel(status)}</Pill>
                    <Pill tone="neutral">{AVAILABILITY_LABEL[provider.availability]}</Pill>
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">{provider.description}</p>
                </div>
              </div>

              <p className="mt-2.5 text-[12px] text-muted-foreground">{detail}</p>

              {provider.permissions.length > 0 ? (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Permissions requested
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {provider.permissions.map((permission) => (
                      <li
                        key={permission}
                        className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground"
                      >
                        <Check className="mt-0.5 size-3 shrink-0" aria-hidden />
                        {permission}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {provider.limitation ? (
                <p className="mt-3 flex items-start gap-1.5 rounded-[10px] border border-border bg-secondary/50 px-2.5 py-2 text-[11.5px] text-muted-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {provider.limitation}
                </p>
              ) : null}

              {provider.envVars.length > 0 ? (
                <p className="mt-2.5 flex flex-wrap gap-1">
                  {provider.envVars.map((name) => (
                    <code
                      key={name}
                      className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {name}
                    </code>
                  ))}
                </p>
              ) : null}

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                {provider.oauth === "google" ? (
                  google.data?.connected ? (
                    <>
                      {/* A stale consent needs a way back to Google's screen.
                          Without this the card says "press Connect again" while
                          offering only Disconnect — an instruction with no
                          button behind it. */}
                      {google.data.missingScopes?.length ? (
                        <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" asChild>
                          <a href="/api/google/auth">
                            <Plug className="size-3.5" aria-hidden />
                            Reconnect
                          </a>
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-[12.5px]"
                        onClick={() => {
                          void fetch("/api/google/status", { method: "DELETE" }).then(() => {
                            void google.refetch();
                            toast.success("Google disconnected");
                          });
                        }}
                      >
                        <LogOut className="size-3.5" aria-hidden />
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-[12.5px]"
                      disabled={!google.data?.configured || !google.data?.encryptionReady}
                      title={
                        google.data?.configured
                          ? google.data?.encryptionReady
                            ? undefined
                            : "Set TOKEN_ENCRYPTION_KEY first"
                          : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first"
                      }
                      asChild={Boolean(google.data?.configured && google.data?.encryptionReady)}
                    >
                      {google.data?.configured && google.data?.encryptionReady ? (
                        <a href="/api/google/auth">
                          <Plug className="size-3.5" aria-hidden />
                          Connect
                        </a>
                      ) : (
                        <>
                          <Plug className="size-3.5" aria-hidden />
                          Connect
                        </>
                      )}
                    </Button>
                  )
                ) : null}
                {canSync ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-[12.5px]"
                    disabled={running}
                    onClick={() => void sync([provider.sync as SyncProvider])}
                  >
                    <RefreshCw
                      className={running ? "size-3.5 animate-spin" : "size-3.5"}
                      aria-hidden
                    />
                    Sync
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-[12.5px]"
                    disabled
                    title={
                      provider.availability === "manual"
                        ? "This provider has no API that supports syncing."
                        : provider.oauth === "google"
                          ? "Connect Google first."
                          : provider.envVars.length > 0
                            ? `Set ${provider.envVars.join(", ")} on the server first.`
                            : "This provider is configured on the server and has nothing to sync."
                    }
                  >
                    {provider.availability === "manual"
                      ? "No API available"
                      : provider.oauth === "google"
                        ? "Connect first"
                        : provider.envVars.length > 0
                          ? "Needs credentials"
                          : "Nothing to sync"}
                  </Button>
                )}
                {provider.docsUrl ? (
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  >
                    Setup docs <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : null}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel className="mt-4">
        <PanelHeader
          title="Sync history"
          meta={`${workspace.syncRuns.length} run${workspace.syncRuns.length === 1 ? "" : "s"}`}
          action={
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-[12px]"
              disabled={running}
              onClick={() => void sync(syncable.map((p) => p.sync))}
            >
              Run all
            </Button>
          }
        />
        {workspace.syncRuns.length === 0 ? (
          <EmptyState
            title="No syncs yet"
            description="Press Sync now to fetch the Wilcox calendars, weather and any configured providers."
          />
        ) : (
          <ul className="divide-y divide-border">
            {workspace.syncRuns.slice(0, 15).map((run) => (
              <li
                key={run.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[12.5px]">
                    <span className="font-medium capitalize">{run.provider}</span>
                    <Pill tone={run.ok ? "success" : "urgent"}>{run.ok ? "OK" : "Failed"}</Pill>
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {run.message}
                  </p>
                </div>
                <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                  {relativeTimeLabel(run.finishedAt ?? run.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {lastPayload ? (
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Last sync touched {lastPayload.runs.length} provider
          {lastPayload.runs.length === 1 ? "" : "s"}:{" "}
          {lastPayload.runs.map((r) => `${r.provider} ${r.ok ? "ok" : "failed"}`).join(", ")}. A
          failure in one provider never blocks the others.
        </p>
      ) : null}
    </div>
  );
}

/** "…/auth/gmail.readonly" → "Gmail access", for a sentence a person can read. */
function shortScope(scope: string): string {
  const tail = scope.split("/").pop() ?? scope;
  const NAMES: Record<string, string> = {
    "gmail.readonly": "Gmail access",
    "calendar.events": "permission to add calendar events",
    "calendar.readonly": "calendar reading",
    "classroom.courses.readonly": "Classroom courses",
    "classroom.coursework.me.readonly": "Classroom coursework",
    "classroom.student-submissions.me.readonly": "Classroom submissions",
  };
  return NAMES[tail] ?? tail;
}

/** ["a", "b", "c"] → "a, b and c". Three "and"s in a row reads as a bug. */
function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

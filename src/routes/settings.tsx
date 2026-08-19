import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, Link2, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { KeyValue, Panel, PanelHeader, Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { relativeTimeLabel } from "@/lib/core/time";
import { useGoogleStatus, useProviderConfig, useSync } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · AaditOS" }] }),
  component: SettingsPage,
});

/** Where the school day starts and ends, which is what free time is measured against. */
function DayWindow() {
  const { workspace, savePreferences } = useOS();
  const prefs = workspace.preferences;

  return (
    <Panel>
      <PanelHeader title="Your day" />
      <div className="space-y-3 px-4 py-4">
        <p className="text-[12.5px] text-muted-foreground">
          Free time on the Today page is measured between these two times, minus whatever is on your
          calendar.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12.5px]">
            Start
            <Input
              type="time"
              value={prefs.workdayStart}
              onChange={(e) => void savePreferences({ workdayStart: e.target.value })}
              className="h-8 w-[110px] text-[12.5px]"
            />
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            End
            <Input
              type="time"
              value={prefs.workdayEnd}
              onChange={(e) => void savePreferences({ workdayEnd: e.target.value })}
              className="h-8 w-[110px] text-[12.5px]"
            />
          </label>
        </div>
        <label className="flex items-center justify-between gap-4 border-t border-border pt-3">
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium">Reduce motion</span>
            <span className="block text-[11.5px] text-muted-foreground">
              Turns off the entrance and settle animations.
            </span>
          </span>
          <Switch
            checked={prefs.reducedMotion}
            onCheckedChange={(checked) => void savePreferences({ reducedMotion: checked })}
          />
        </label>
      </div>
    </Panel>
  );
}

/**
 * What is connected.
 *
 * Three providers, so this is a short list rather than the fourteen-card page
 * it replaced. Wilcox and the weather need no credentials and simply work;
 * Google is the only one that can need a human.
 */
function Connections() {
  const config = useProviderConfig();
  const google = useGoogleStatus();
  const { workspace } = useOS();
  const { sync, running } = useSync();

  const lastRun = workspace.syncRuns[0];
  const googleConnected = google.data?.connected ?? false;
  const googleConfigured = google.data?.configured ?? false;
  const needsReconnect = (google.data?.missingScopes.length ?? 0) > 0;

  return (
    <Panel>
      <PanelHeader
        title="Connected"
        meta={lastRun?.finishedAt ? `synced ${relativeTimeLabel(lastRun.finishedAt)}` : undefined}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-[12.5px]"
            disabled={running}
            onClick={() => void sync(["wilcox", "weather", "google"])}
          >
            <RefreshCw className={running ? "size-3.5 animate-spin" : "size-3.5"} />
            Sync now
          </Button>
        }
      />
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Wilcox calendars</p>
            <p className="text-[11.5px] text-muted-foreground">
              School, district, athletics and counseling. No sign-in needed.
            </p>
          </div>
          <Pill tone="success">
            <Check className="size-3" aria-hidden /> On
          </Pill>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Santa Clara weather</p>
            <p className="text-[11.5px] text-muted-foreground">
              Today's conditions from Open-Meteo. No sign-in needed.
            </p>
          </div>
          <Pill tone="success">
            <Check className="size-3" aria-hidden /> On
          </Pill>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Google Calendar &amp; Classroom</p>
            <p className="text-[11.5px] text-muted-foreground">
              {googleConnected
                ? needsReconnect
                  ? "Connected, but a newer permission is missing — reconnect to fix it."
                  : `Connected as ${google.data?.email ?? "your account"}.`
                : googleConfigured
                  ? "Not connected. A school-managed account may refuse this."
                  : "No Google client is configured on the server."}
            </p>
          </div>
          {googleConfigured ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" asChild>
              <a href="/api/google/auth">
                <Link2 className="size-3.5" />
                {googleConnected ? "Reconnect" : "Connect"}
              </a>
            </Button>
          ) : (
            <Pill tone="neutral">Off</Pill>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Assistant</p>
            <p className="text-[11.5px] text-muted-foreground">
              {config.data?.openai
                ? `Running ${config.data.openaiModel}.`
                : "No OPENAI_API_KEY on the server."}
            </p>
          </div>
          <Pill tone={config.data?.openai ? "success" : "neutral"}>
            {config.data?.openai ? "On" : "Off"}
          </Pill>
        </div>
      </div>
    </Panel>
  );
}

/** Export and delete. Both operate on this account only. */
function DataSection() {
  const { exportWorkspace, deleteAllData, workspace, profile } = useOS();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const data = await exportWorkspace();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aaditos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported");
    } finally {
      setBusy(false);
    }
  }

  const counts = `${workspace.tasks.length} tasks · ${workspace.notes.length} notes · ${workspace.events.length} events`;

  return (
    <Panel>
      <PanelHeader title="Your data" meta={counts} />
      <div className="px-4 py-4">
        <dl>
          <KeyValue label="Signed in as">{profile.email || "—"}</KeyValue>
          <KeyValue label="Classes">{workspace.courses.length}</KeyValue>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-[12.5px]"
            disabled={busy}
            onClick={() => void download()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Export everything
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-urgent/30 text-[12.5px] text-urgent hover:bg-urgent-soft"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3.5" />
            Delete all data
          </Button>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-urgent" aria-hidden />
              Delete everything?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes every task, note, class and event on this account. It cannot be undone.
              Export first if you want a copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void deleteAllData().then(() => toast.success("Everything deleted"));
              }}
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function SettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Three things worth changing, and your data.
        </p>
      </div>
      <Connections />
      <DayWindow />
      <DataSection />
    </div>
  );
}

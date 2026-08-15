import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Download,
  LogOut,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { KeyValue, Panel, PanelHeader, Pill, Segmented } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth/context";
import { DEFAULT_BELL_SCHEDULE, SCHOOL_YEAR, formatMin } from "@/lib/core/schedule";
import { relativeTimeLabel } from "@/lib/core/time";
import { useProviderConfig } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · AaditOS" },
      { name: "description", content: "Profile, appearance, AI preferences, data and privacy." },
    ],
  }),
  component: SettingsPage,
});

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmWord,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmWord?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const ready = !confirmWord || typed === confirmWord;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{title}</DialogTitle>
          <DialogDescription className="text-[12.5px]">{description}</DialogDescription>
        </DialogHeader>
        {confirmWord ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-word" className="text-[12px]">
              Type <span className="font-mono">{confirmWord}</span> to confirm
            </Label>
            <Input
              id="confirm-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-9 text-[13px]"
              autoComplete="off"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[12.5px]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className={
              destructive
                ? "h-8 bg-destructive text-[12.5px] hover:bg-destructive/90"
                : "h-8 text-[12.5px]"
            }
            disabled={!ready}
            onClick={() => {
              void Promise.resolve(onConfirm()).then(() => {
                setTyped("");
                onOpenChange(false);
              });
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPage() {
  const {
    workspace,
    profile,
    isDemo,
    theme,
    setTheme,
    savePreferences,
    exportWorkspace,
    resetDemoData,
    deleteAllData,
    repositoryKind,
  } = useOS();
  const { signOut, supabaseConfigured, session } = useAuth();
  const config = useProviderConfig();
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const prefs = workspace.preferences;

  async function exportJson() {
    const data = await exportWorkspace();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aaditos-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success("Export downloaded");
  }

  return (
    <div className="mx-auto max-w-[820px] space-y-4">
      <div className="pb-1">
        <h1 className="display text-[23px]">Settings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Profile, appearance, notifications, AI behaviour, data and privacy.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Profile" />
        <dl className="divide-y divide-border px-4 py-1">
          <KeyValue label="Name">{profile.name || "—"}</KeyValue>
          <KeyValue label="Email">{profile.email || "—"}</KeyValue>
          <KeyValue label="School">{profile.school}</KeyValue>
          <KeyValue label="Grade">
            {profile.grade} · {SCHOOL_YEAR.label}
          </KeyValue>
          <KeyValue label="Timezone">{profile.timezone}</KeyValue>
          <KeyValue label="Session">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={isDemo ? "primary" : "success"}>
                {isDemo ? "Demo mode" : "Signed in with Google"}
              </Pill>
              <Pill tone="neutral">
                {repositoryKind === "supabase" ? "Supabase storage" : "This browser only"}
              </Pill>
            </div>
          </KeyValue>
        </dl>
        <div className="border-t border-border px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-[12.5px]"
            onClick={() => void signOut()}
          >
            <LogOut className="size-3.5" aria-hidden />
            {isDemo ? "Leave demo mode" : "Sign out"}
          </Button>
          {!supabaseConfigured ? (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Google sign-in is unavailable because Supabase is not configured in this deployment.
              Data stays in this browser.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Appearance" />
        <div className="space-y-4 px-4 py-3">
          <div>
            <p className="mb-2 text-[12px] text-muted-foreground">Theme</p>
            <Segmented
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {theme === "light" ? (
                <Sun className="size-3" aria-hidden />
              ) : theme === "dark" ? (
                <Moon className="size-3" aria-hidden />
              ) : (
                <Monitor className="size-3" aria-hidden />
              )}
              Applied before the first paint, so there is no flash on reload.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <label htmlFor="reduced-motion" className="text-[12.5px]">
              Reduce motion
              <span className="block text-[11.5px] text-muted-foreground">
                Removes transitions and animations across the app.
              </span>
            </label>
            <Switch
              id="reduced-motion"
              checked={prefs.reducedMotion}
              onCheckedChange={(checked) => void savePreferences({ reducedMotion: checked })}
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Goals and workday" />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="focus-goal" className="text-[12px]">
              Weekly focus goal (hours)
            </Label>
            <Input
              id="focus-goal"
              type="number"
              min={1}
              max={60}
              value={prefs.focusGoalHours}
              className="h-9 text-[13px]"
              onChange={(e) =>
                void savePreferences({
                  focusGoalHours: Math.max(1, Math.min(60, Number(e.target.value) || 10)),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-goal" className="text-[12px]">
              Weekly task goal
            </Label>
            <Input
              id="task-goal"
              type="number"
              min={1}
              max={200}
              value={prefs.weeklyTaskGoal}
              className="h-9 text-[13px]"
              onChange={(e) =>
                void savePreferences({
                  weeklyTaskGoal: Math.max(1, Math.min(200, Number(e.target.value) || 18)),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workday-start" className="text-[12px]">
              Workday starts
            </Label>
            <Input
              id="workday-start"
              type="time"
              value={prefs.workdayStart}
              className="h-9 text-[13px]"
              onChange={(e) => void savePreferences({ workdayStart: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workday-end" className="text-[12px]">
              Workday ends
            </Label>
            <Input
              id="workday-end"
              type="time"
              value={prefs.workdayEnd}
              className="h-9 text-[13px]"
              onChange={(e) => void savePreferences({ workdayEnd: e.target.value })}
            />
          </div>
        </div>
        <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
          These bound the &ldquo;focus time available&rdquo; calculation on Today and the plans
          Compass builds.
        </p>
      </Panel>

      <Panel>
        <PanelHeader title="School schedule" meta="Local defaults" />
        <ul className="divide-y divide-border">
          {DEFAULT_BELL_SCHEDULE.map((slot) => {
            const course = workspace.courses.find((c) => c.active && c.period === slot.period);
            return (
              <li
                key={`${slot.period}-${slot.label}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-2"
              >
                <span className="truncate text-[12.5px]">{course?.name ?? slot.label}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                  {formatMin(slot.startMin)} – {formatMin(slot.endMin)}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
          Santa Clara USD publishes no machine-readable bell schedule, so these times are local
          defaults defined in{" "}
          <code className="rounded bg-secondary px-1">src/lib/core/schedule.ts</code>. Everything
          else about school days comes from the synced Wilcox calendar.
        </p>
      </Panel>

      <Panel>
        <PanelHeader title="AI preferences" />
        <div className="space-y-4 px-4 py-3">
          <div>
            <p className="mb-2 text-[12px] text-muted-foreground">Compass tone</p>
            <Segmented
              label="Compass tone"
              value={prefs.compassTone}
              onChange={(value) => void savePreferences({ compassTone: value })}
              options={[
                { value: "concise", label: "Concise" },
                { value: "coach", label: "Coach" },
                { value: "detailed", label: "Detailed" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <label htmlFor="auto-tools" className="text-[12.5px]">
              Let Compass read your data automatically
              <span className="block text-[11.5px] text-muted-foreground">
                Read-only tools run without asking. Write actions always need confirmation, and this
                setting cannot change that.
              </span>
            </label>
            <Switch
              id="auto-tools"
              checked={prefs.compassAutoRunReadTools}
              onCheckedChange={(checked) =>
                void savePreferences({ compassAutoRunReadTools: checked })
              }
            />
          </div>
          <dl className="divide-y divide-border border-t border-border pt-1">
            <KeyValue label="Status">
              {config.isLoading ? (
                <span className="text-muted-foreground">Checking…</span>
              ) : config.data?.openai ? (
                <Pill tone="success">Configured · {config.data.openaiModel}</Pill>
              ) : (
                <Pill tone="warning">OPENAI_API_KEY not set</Pill>
              )}
            </KeyValue>
            <KeyValue label="Retention">
              Requests use <code className="rounded bg-secondary px-1">store: false</code>; OpenAI
              keeps nothing.
            </KeyValue>
            <KeyValue label="Identity">
              A salted hash is sent as the safety identifier — never your name or email.
            </KeyValue>
          </dl>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Data" />
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12.5px]"
              onClick={() => void exportJson()}
            >
              <Download className="size-3.5" aria-hidden /> Export everything (JSON)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12.5px]"
              disabled={repositoryKind !== "local"}
              title={
                repositoryKind === "local"
                  ? undefined
                  : "Demo data reset is only available for browser-stored workspaces."
              }
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw className="size-3.5" aria-hidden /> Reset demo data
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12.5px] text-urgent hover:text-urgent"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" aria-hidden /> Delete all data
            </Button>
          </div>
          <dl className="divide-y divide-border">
            <KeyValue label="Stored here">
              {workspace.tasks.length} tasks · {workspace.focusSessions.length} focus sessions ·{" "}
              {workspace.events.length} events · {workspace.opportunities.length} opportunities
            </KeyValue>
            <KeyValue label="Storage">
              {repositoryKind === "supabase"
                ? "Supabase Postgres with Row Level Security"
                : "This browser's local storage"}
            </KeyValue>
            <KeyValue label="Last sync">
              {workspace.syncRuns[0]
                ? `${workspace.syncRuns[0].provider} · ${relativeTimeLabel(
                    workspace.syncRuns[0].finishedAt ?? workspace.syncRuns[0].startedAt,
                  )}`
                : "Never"}
            </KeyValue>
          </dl>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Privacy" />
        <div className="space-y-2 px-4 py-3 text-[12.5px] text-muted-foreground">
          <p>
            AaditOS is a private app. The dashboard is behind authentication, and pages are marked{" "}
            <code className="rounded bg-secondary px-1">noindex, nofollow</code>.
          </p>
          <p>
            Provider tokens live only in server environment variables and are never sent to the
            browser. The Integrations page receives booleans, not secrets.
          </p>
          <p>
            Compass receives your question plus a summary of your workspace for that question only.
            Prompt content is never logged; only token counts and success or failure are recorded.
          </p>
          <p>
            {session?.mode === "demo"
              ? "In demo mode nothing leaves this browser except public calendar and weather requests you trigger."
              : "Your workspace is stored where the Storage row above says, and nowhere else."}
          </p>
        </div>
      </Panel>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset to demo data?"
        description="This replaces everything in this browser with a fresh set of realistic sample data. Anything you created here will be lost."
        confirmLabel="Reset demo data"
        onConfirm={async () => {
          await resetDemoData();
          toast.success("Demo data restored");
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete all data?"
        description="Every task, focus session, event, opportunity and preference is removed. This cannot be undone — export first if you want a copy."
        confirmLabel="Delete everything"
        confirmWord="DELETE"
        destructive
        onConfirm={async () => {
          await deleteAllData();
          toast.success("All data deleted");
        }}
      />

      <p className="flex items-start gap-1.5 pb-4 text-[11.5px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
        Deleting data here only affects AaditOS. It does not change anything in Google Classroom,
        GitHub, Vercel or Spotify.
      </p>
    </div>
  );
}

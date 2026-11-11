import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Link2, Loader2, Mail, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Panel, Pill } from "@/components/os/primitives";
import { ProviderMark, type ProviderMarkId } from "@/components/os/provider-marks";
import { Button } from "@/components/ui/button";
import { withBase } from "@/lib/base-path";
import { authHeaders } from "@/lib/compass/client";
import { relativeTimeLabel } from "@/lib/core/time";
import type { IntegrationRecord } from "@/lib/core/types";
import {
  ALL_SYNCABLE,
  PROVIDER_INTEGRATION_IDS,
  type GoogleStatus,
  type InboxItem,
  type ProviderCapabilities,
  type SyncProvider,
} from "@/lib/integrations/contracts";
import {
  INBOX_KEY,
  useGoogleStatus,
  useProviderConfig,
  useSync,
} from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/integrations")({
  head: () => ({ meta: [{ title: "Integrations" }] }),
  // Optional keys, so a plain <Link to="/integrations"> needs no search prop.
  validateSearch: (
    search: Record<string, unknown>,
  ): { google?: string; message?: string; email?: string } => {
    const out: { google?: string; message?: string; email?: string } = {};
    if (typeof search["google"] === "string") out.google = search["google"];
    if (typeof search["message"] === "string") out.message = search["message"];
    if (typeof search["email"] === "string") out.email = search["email"];
    return out;
  },
  component: IntegrationsPage,
});

type State = "on" | "connect" | "setup" | "error" | "reconnect";

interface Card {
  id: string;
  mark: ProviderMarkId;
  name: string;
  /** One line: what it does for you. */
  what: string;
  provider?: SyncProvider | undefined;
  state: State;
  /** Status line under the name, when there is something worth saying. */
  status?: string | undefined;
  /** The one action. Connect for OAuth, Set up for a token. */
  action?: ReactNode;
  /** Shown under "Set up": which variable to add and where to get it. */
  setup?: { env: string; where: string; url: string } | undefined;
  /** Anything more the card needs, such as a list of connected accounts. */
  extra?: ReactNode;
}

const TONE: Record<State, "success" | "neutral" | "warning" | "urgent" | "primary"> = {
  on: "success",
  connect: "primary",
  setup: "neutral",
  error: "urgent",
  reconnect: "warning",
};

const WORD: Record<State, string> = {
  on: "On",
  connect: "Not connected",
  setup: "Needs a key",
  error: "Error",
  reconnect: "Reconnect",
};

function stateFor(
  configured: boolean,
  record: IntegrationRecord | undefined,
  connected = true,
): State {
  if (!configured) return "setup";
  if (!connected) return "connect";
  if (record?.status === "error") return "error";
  return "on";
}

function IntegrationCard({ card }: { card: Card }) {
  return (
    <Panel
      as="article"
      className={cn("flex flex-col", card.state === "error" && "border-urgent/30")}
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-background">
          <ProviderMark id={card.mark} className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-[13.5px] font-semibold tracking-tight">{card.name}</h2>
            <Pill tone={TONE[card.state]}>
              {card.state === "on" ? <Check className="size-3" aria-hidden /> : null}
              {WORD[card.state]}
            </Pill>
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{card.what}</p>
        </div>
      </div>
      {card.extra ? <div className="mt-3 px-4">{card.extra}</div> : null}
      <div className="mt-3 flex items-end justify-between gap-3 px-4 pb-4">
        <p
          className={cn(
            "min-w-0 text-[11.5px]",
            card.state === "error" ? "text-urgent" : "text-muted-foreground",
          )}
        >
          {card.status ??
            (card.setup ? (
              <>
                Add{" "}
                <code className="rounded bg-secondary px-1 text-[10.5px]">{card.setup.env}</code> on
                the server.{" "}
                <a
                  href={card.setup.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  {card.setup.where}
                </a>
              </>
            ) : (
              ""
            ))}
        </p>
        {card.action ? <div className="shrink-0">{card.action}</div> : null}
      </div>
    </Panel>
  );
}

function ConnectLink({ href, label }: { href: string; label: string }) {
  return (
    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" asChild>
      <a href={href}>
        <Link2 className="size-3.5" aria-hidden />
        {label}
      </a>
    </Button>
  );
}

/**
 * Every connected mailbox, each removable on its own, and a way to add
 * another. Google asks which account every time, so "Add an email" is how a
 * second personal account or a school account gets in.
 */
function MailAccounts({
  accounts,
  max,
  onRemoved,
}: {
  accounts: GoogleStatus["accounts"];
  max: number;
  onRemoved: (email: string) => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const mail = accounts.filter((a) => a.gmail && a.email);

  async function remove(email: string) {
    setRemoving(email);
    try {
      const response = await fetch(
        withBase(`api/google/status?email=${encodeURIComponent(email)}`),
        { method: "DELETE", headers: await authHeaders() },
      );
      if (!response.ok) throw new Error(`Could not disconnect (${response.status})`);
      onRemoved(email);
      toast.success("Disconnected", { description: email });
    } catch (error) {
      toast.error("Could not disconnect", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-2">
      {mail.length > 0 ? (
        <ul className="divide-y divide-border rounded-[10px] border border-border">
          {mail.map((account) => (
            <li key={account.email} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
              <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{account.email}</span>
              {account.main ? (
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  Calendar & Classroom too
                </span>
              ) : null}
              {!account.canReply ? (
                <a
                  href={withBase(
                    `api/google/auth?add=mail&hint=${encodeURIComponent(account.email ?? "")}`,
                  )}
                  className="shrink-0 text-[11.5px] text-primary underline-offset-2 hover:underline"
                >
                  Allow replies
                </a>
              ) : null}
              <button
                type="button"
                aria-label={`Disconnect ${account.email}`}
                title="Disconnect"
                disabled={removing !== null}
                onClick={() => void remove(account.email ?? "")}
                className="grid size-6 shrink-0 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-secondary hover:text-urgent disabled:opacity-50"
              >
                {removing === account.email ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <X className="size-3.5" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {accounts.length < max ? (
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" asChild>
          <a href={withBase("api/google/auth?add=mail")}>
            <Plus className="size-3.5" aria-hidden />
            {mail.length === 0 ? "Connect an email" : "Add another email"}
          </a>
        </Button>
      ) : (
        <p className="text-[11.5px] text-muted-foreground">
          {max} accounts is the most this can hold. Remove one to add another.
        </p>
      )}
    </div>
  );
}

function buildCards(opts: {
  config: ProviderCapabilities | undefined;
  google: {
    configured: boolean;
    connected: boolean;
    email: string | null;
    gmail: boolean;
    missing: number;
    accounts: GoogleStatus["accounts"];
    maxAccounts: number;
  };
  records: Map<string, IntegrationRecord>;
  onMailRemoved: (email: string) => void;
}): Card[] {
  const { config, google, records } = opts;
  const mailCount = google.accounts.filter((a) => a.gmail).length;
  const rec = (provider: SyncProvider) => records.get(PROVIDER_INTEGRATION_IDS[provider]);
  const synced = (provider: SyncProvider) => {
    const r = rec(provider);
    if (r?.status === "error") return r.lastError ?? "The last sync failed.";
    return r?.lastSyncAt ? `Synced ${relativeTimeLabel(r.lastSyncAt)}` : undefined;
  };

  const googleState: State = !google.configured
    ? "setup"
    : !google.connected
      ? "connect"
      : google.missing > 0
        ? "reconnect"
        : stateFor(true, rec("google"));

  return [
    {
      id: "wilcox",
      mark: "wilcox",
      name: "Wilcox calendars",
      what: "School, district, athletics and counseling, read straight from the school site.",
      provider: "wilcox",
      state: stateFor(true, rec("wilcox")),
      status: synced("wilcox") ?? "No sign-in needed.",
    },
    {
      id: "classroom",
      mark: "googleclassroom",
      name: "Google Classroom",
      what: "Your classes, coursework and whether you turned it in.",
      provider: "google",
      state: googleState,
      status:
        googleState === "on"
          ? `Connected as ${google.email ?? "your account"}.`
          : googleState === "reconnect"
            ? "A newer permission is missing. Reconnect to fix it."
            : googleState === "connect"
              ? "Read-only. A school-managed account may refuse this."
              : undefined,
      setup: google.configured
        ? undefined
        : {
            env: "GOOGLE_CLIENT_ID",
            where: "Google Cloud Console",
            url: "https://console.cloud.google.com/apis/credentials",
          },
      action: google.configured ? (
        <ConnectLink
          href={withBase("api/google/auth")}
          label={google.connected ? "Reconnect" : "Connect"}
        />
      ) : undefined,
    },
    {
      id: "calendar",
      mark: "googlecalendar",
      name: "Google Calendar",
      what: "Personal events from your primary calendar, next 45 days.",
      state: googleState,
      status:
        googleState === "on"
          ? (synced("google") ?? "Same connection as Classroom.")
          : "Same connection as Classroom.",
    },
    {
      id: "gmail",
      mark: "gmail",
      name: "Gmail",
      what: "Every inbox you connect, side by side on the Email page. Read and reply: nothing is sent until you press Send, and nothing is ever deleted.",
      provider: "gmail",
      state: !google.configured
        ? "setup"
        : mailCount === 0
          ? "connect"
          : stateFor(true, rec("gmail")),
      status: !google.configured
        ? undefined
        : mailCount > 0
          ? (synced("gmail") ??
            `${mailCount} account${mailCount === 1 ? "" : "s"} connected. Google asks which account each time.`)
          : "Google asks which account to use, so any Gmail or school address works.",
      extra: google.configured ? (
        <MailAccounts
          accounts={google.accounts}
          max={google.maxAccounts}
          onRemoved={opts.onMailRemoved}
        />
      ) : undefined,
    },
    {
      id: "aeries",
      mark: "aeries",
      name: "Aeries",
      what: "The official gradebook: classes, teachers, periods and scores.",
      provider: "aeries",
      state: stateFor(Boolean(config?.aeries), rec("aeries")),
      status: config?.aeries
        ? synced("aeries")
        : "Needs an API certificate from the district Aeries administrator.",
      setup: config?.aeries
        ? undefined
        : { env: "AERIES_CERT", where: "Ask the district", url: "https://www.aeries.com/" },
    },
    {
      id: "github",
      mark: "github",
      name: "GitHub",
      what: "Issues assigned to you and pull requests waiting on you.",
      provider: "github",
      state: stateFor(Boolean(config?.github), rec("github")),
      status: config?.github ? synced("github") : undefined,
      setup: config?.github
        ? undefined
        : {
            env: "GITHUB_TOKEN",
            where: "Fine-grained token, read-only",
            url: "https://github.com/settings/personal-access-tokens/new",
          },
    },
    {
      id: "slack",
      mark: "slack",
      name: "Slack",
      what: "Messages that mention you, and your DMs, from the last week.",
      provider: "slack",
      state: stateFor(Boolean(config?.slack), rec("slack")),
      status: config?.slack ? synced("slack") : undefined,
      setup: config?.slack
        ? undefined
        : {
            env: "SLACK_USER_TOKEN",
            where: "A Slack app with search:read",
            url: "https://api.slack.com/apps",
          },
    },
    {
      id: "notion",
      mark: "notion",
      name: "Notion",
      what: "Open to-dos from your to-do page as tasks, and pages edited this week.",
      provider: "notion",
      state: stateFor(Boolean(config?.notion), rec("notion")),
      status: config?.notion ? synced("notion") : undefined,
      setup: config?.notion
        ? undefined
        : {
            env: "NOTION_TOKEN",
            where: "Internal integration",
            url: "https://www.notion.so/my-integrations",
          },
    },
    {
      id: "weather",
      mark: "weather",
      name: "Santa Clara weather",
      what: "Today's conditions, from Open-Meteo.",
      provider: "weather",
      state: stateFor(true, rec("weather")),
      status: synced("weather") ?? "No sign-in needed.",
    },
    {
      id: "assistant",
      mark: "openai",
      name: "Assistant",
      what: "Capture and Ask. Falls back across models and keys so it keeps answering.",
      state: config?.openai ? "on" : "setup",
      status: config?.openai
        ? `${config.openaiModels.join(" → ")} · ${config.openaiKeys} key${config.openaiKeys === 1 ? " (add OPENAI_API_KEY_FALLBACK for a spare)" : "s"}`
        : undefined,
      setup: config?.openai
        ? undefined
        : {
            env: "OPENAI_API_KEY",
            where: "OpenAI dashboard",
            url: "https://platform.openai.com/api-keys",
          },
    },
  ];
}

function IntegrationsPage() {
  const search = useSearch({ from: "/integrations" });
  const config = useProviderConfig();
  const google = useGoogleStatus();
  const { workspace } = useOS();
  const { sync, running } = useSync();
  const queryClient = useQueryClient();

  // The Google callback lands here with the outcome in the URL.
  useEffect(() => {
    if (search.google === "connected") {
      toast.success("Google connected", { description: search.email });
      void google.refetch();
      void sync(["google", "gmail"]);
    } else if (search.google === "error") {
      toast.error("Google did not connect", { description: search.message });
    }
    // Run once per landing, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.google, search.message]);

  const records = new Map(workspace.integrations.map((r) => [r.id, r]));
  const cards = buildCards({
    config: config.data,
    google: {
      configured: google.data?.configured ?? false,
      connected: google.data?.connected ?? false,
      email: google.data?.email ?? null,
      gmail: google.data?.gmail ?? false,
      missing: google.data?.missingScopes.length ?? 0,
      accounts: google.data?.accounts ?? [],
      maxAccounts: google.data?.maxAccounts ?? 5,
    },
    records,
    onMailRemoved: (email) => {
      queryClient.setQueryData<InboxItem[]>(INBOX_KEY, (prev) =>
        (prev ?? []).filter((i) => i.account?.toLowerCase() !== email.toLowerCase()),
      );
      void google.refetch();
    },
  });

  const on = cards.filter((c) => c.state === "on").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">Integrations</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {on} of {cards.length} on. Everything here only reads, except replies you send from the
            Email page.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[12.5px]"
          disabled={running}
          onClick={() => void sync(ALL_SYNCABLE)}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden />
          )}
          Sync everything
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <IntegrationCard key={card.id} card={card} />
        ))}
      </div>

      <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
        <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span>
          Keys and tokens live only on the server, in the host's environment settings. The browser
          never sees one, and this page only ever learns whether a key exists.
        </span>
      </p>
    </div>
  );
}

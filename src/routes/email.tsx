import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ExternalLink,
  Inbox as InboxIcon,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, Panel } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { withBase } from "@/lib/base-path";
import { relativeTimeLabel } from "@/lib/core/time";
import { useCapture } from "@/lib/hooks/use-capture";
import type { InboxItem } from "@/lib/integrations/contracts";
import {
  useGoogleStatus,
  useInbox,
  useMailAccounts,
  useSync,
} from "@/lib/integrations/use-integrations";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/email")({
  head: () => ({ meta: [{ title: "Email" }] }),
  component: EmailPage,
});

/**
 * Every connected inbox in one list.
 *
 * The last two weeks of inbox mail from each account, without promotions and
 * social, newest first: who wrote, what about, and whether it is unread. One
 * account at a time or all together; search narrows it; Open goes to that
 * message in the right Gmail account; File turns it into a task, an event or
 * a note. Read-only — nothing here can send, archive or delete.
 */
function EmailPage() {
  const google = useGoogleStatus();
  const { items, dismiss } = useInbox();
  const summaries = useMailAccounts();
  const { sync, running } = useSync();
  const [account, setAccount] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const mailAccounts = (google.data?.accounts ?? []).filter((a) => a.gmail && a.email);
  const emails = useMemo(() => items.filter((i) => i.source === "gmail"), [items]);

  // The list lives in memory, so a fresh page load fetches it once.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || running || mailAccounts.length === 0 || summaries.length > 0) return;
    asked.current = true;
    void sync(["gmail"]);
  }, [mailAccounts.length, summaries.length, running, sync]);

  const unreadFor = (email: string) =>
    summaries.find((s) => s.email.toLowerCase() === email.toLowerCase())?.unread;
  const totalUnread = summaries.reduce((n, s) => n + (s.unread ?? 0), 0);
  const failing = summaries.filter((s) => !s.ok);

  const needle = query.trim().toLowerCase();
  const visible = emails.filter((item) => {
    if (account !== "all" && item.account?.toLowerCase() !== account.toLowerCase()) return false;
    if (unreadOnly && !item.unread) return false;
    if (!needle) return true;
    return [item.title, item.from, item.detail, item.account]
      .filter(Boolean)
      .some((v) => (v ?? "").toLowerCase().includes(needle));
  });

  const configured = google.data?.configured ?? false;
  const loadingStatus = google.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">Email</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {mailAccounts.length === 0
              ? "Connect an inbox to see it here."
              : `${totalUnread > 0 ? `${totalUnread} unread` : "Nothing unread"} across ${mailAccounts.length} account${mailAccounts.length === 1 ? "" : "s"} · last two weeks, no promotions`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mailAccounts.length > 0 ? (
            <>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" asChild>
                <Link
                  to="/ask"
                  search={{ q: "What's new in my email? Anything I need to act on?" }}
                >
                  <Sparkles className="size-3.5" aria-hidden /> Summarize
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-[12.5px]"
                disabled={running}
                onClick={() => void sync(["gmail"])}
              >
                {running ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden />
                )}
                Refresh
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {loadingStatus ? null : !configured ? (
        <Panel>
          <EmptyState
            icon={Mail}
            title="Google is not set up on the server"
            description="Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the host's settings, then connect an inbox."
          />
        </Panel>
      ) : mailAccounts.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Mail}
            title="No inbox connected"
            description="Connect any Gmail or Google school account. Google asks which account to use, and you can add more than one."
          />
          <div className="flex justify-center pb-5">
            <Button size="sm" className="h-9 gap-1.5 text-[13px]" asChild>
              <a href={withBase("api/google/auth?add=mail")}>
                <Plus className="size-4" aria-hidden /> Connect an email
              </a>
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Account">
              <Chip active={account === "all"} onClick={() => setAccount("all")}>
                All
                {totalUnread > 0 ? <Count n={totalUnread} /> : null}
              </Chip>
              {mailAccounts.map((a) => (
                <Chip
                  key={a.email}
                  active={account === a.email}
                  onClick={() => setAccount(a.email ?? "all")}
                >
                  <span className="max-w-48 truncate">{a.email}</span>
                  {(unreadFor(a.email ?? "") ?? 0) > 0 ? (
                    <Count n={unreadFor(a.email ?? "") ?? 0} />
                  ) : null}
                </Chip>
              ))}
              <a
                href={withBase("api/google/auth?add=mail")}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Plus className="size-3.5" aria-hidden /> Add
              </a>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                  className="accent-[var(--color-primary)]"
                />
                Unread only
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search mail"
                  aria-label="Search mail"
                  className="h-8 w-44 rounded-full border border-border bg-card pl-8 pr-3 text-[12.5px] outline-none focus:border-foreground/25"
                />
              </div>
            </div>
          </div>

          {failing.length > 0 ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border border-warning/30 bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning-strong"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                {failing.map((f) => `${f.email}: ${f.error ?? "could not be read"}`).join(" · ")}.{" "}
                <Link to="/integrations" className="underline underline-offset-2">
                  Reconnect it
                </Link>
                .
              </span>
            </div>
          ) : null}

          <Panel>
            {running && emails.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Reading your inboxes…
              </p>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title={emails.length === 0 ? "Nothing new" : "No matches"}
                description={
                  emails.length === 0
                    ? "No inbox mail in the last two weeks, outside promotions and social."
                    : "Nothing here matches that filter."
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((item) => (
                  <EmailRow
                    key={item.id}
                    item={item}
                    showAccount={mailAccounts.length > 1 && account === "all"}
                    onFiled={() => dismiss(item.id)}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
        active
          ? "border-foreground/15 bg-secondary font-medium text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold tabular-nums text-primary-foreground">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function EmailRow({
  item,
  showAccount,
  onFiled,
}: {
  item: InboxItem;
  showAccount: boolean;
  onFiled: () => void;
}) {
  const capture = useCapture();
  const [busy, setBusy] = useState(false);

  async function file() {
    setBusy(true);
    // The received date lets "this Friday" in an older email resolve to the right Friday.
    const text = [
      item.title,
      item.detail,
      item.from ? `From ${item.from}` : "",
      `Received ${new Date(item.at).toString()}`,
      item.url,
    ]
      .filter(Boolean)
      .join("\n");
    const outcome = await capture({ text, sourceLabel: "Gmail" });
    setBusy(false);
    if (outcome.ok) onFiled();
  }

  return (
    <li className="group flex items-start gap-3 px-4 py-3">
      <span
        aria-label={item.unread ? "Unread" : undefined}
        className={cn(
          "mt-[7px] size-2 shrink-0 rounded-full",
          item.unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              "truncate text-[13.5px]",
              item.unread ? "font-semibold" : "text-foreground/85",
            )}
          >
            {item.from ?? "Unknown sender"}
          </p>
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
            {relativeTimeLabel(item.at)}
          </span>
        </div>
        <p className={cn("truncate text-[13px]", item.unread ? "font-medium" : "")}>{item.title}</p>
        {item.detail ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{item.detail}</p>
        ) : null}
        {showAccount && item.account ? (
          <p className="mt-1 text-[11px] text-muted-foreground/80">{item.account}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11.5px]"
          disabled={busy}
          onClick={() => void file()}
          title="Turn it into a task, an event or a note"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "File"}
        </Button>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Open in Gmail"
            title="Open in Gmail"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

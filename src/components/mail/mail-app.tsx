/**
 * The mail client.
 *
 * Laid out the way people already know mail: Compose and the folders on the
 * left, search across the top, Primary / Promotions / Social / Updates over
 * the inbox, one row per conversation, and the conversation opening in place.
 * Every connected account at once ("All inboxes") or one at a time.
 *
 * Archive, star, read state, Spam and Trash need the account's gmail.modify
 * permission; without it those buttons stay hidden and a banner offers to
 * turn them on. Trash is undoable — Gmail empties it after 30 days.
 */

import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArrowRight,
  Check,
  File as FileIcon,
  Inbox,
  Info,
  Loader2,
  Mail,
  MailOpen,
  Mails,
  Menu,
  Minus,
  OctagonAlert,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Compose, type ComposeDraft } from "@/components/mail/compose";
import { Avatar, ThreadPane } from "@/components/mail/thread-view";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { withBase } from "@/lib/base-path";
import { useGoogleStatus } from "@/lib/integrations/use-integrations";
import {
  fetchCounts,
  fetchThread,
  groupThreads,
  listDate,
  listPage,
  modify,
  type Category,
  type FolderId,
  type MailAction,
  type MailSummary,
  type MailThreadRow,
  type ThreadView,
} from "@/lib/mail/api";
import { cn } from "@/lib/utils";

export interface MailSearch {
  folder?: FolderId;
  cat?: Category;
  q?: string;
  /** Open conversation, and the account it is in. */
  thread?: string;
  in?: string;
  /** One account, or all of them when absent. */
  account?: string;
}

const FOLDERS: Array<{ id: FolderId; label: string; icon: LucideIcon }> = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "starred", label: "Starred", icon: Star },
  { id: "important", label: "Important", icon: Tag },
  { id: "sent", label: "Sent", icon: Send },
  { id: "drafts", label: "Drafts", icon: FileIcon },
  { id: "all", label: "All Mail", icon: Mails },
  { id: "spam", label: "Spam", icon: OctagonAlert },
  { id: "trash", label: "Trash", icon: Trash2 },
];

const CATEGORIES: Array<{ id: Category; label: string; icon: LucideIcon }> = [
  { id: "primary", label: "Primary", icon: Inbox },
  { id: "promotions", label: "Promotions", icon: Tag },
  { id: "social", label: "Social", icon: Users },
  { id: "updates", label: "Updates", icon: Info },
];

interface Page {
  items: MailSummary[];
  tokens: Record<string, string | null>;
  errors: Record<string, string>;
}

type Target = { account: string; threadId: string };

/** A change to the address: `undefined` clears that part. */
type SearchPatch = { [K in keyof MailSearch]?: MailSearch[K] | undefined };

function withoutEmpty(search: SearchPatch): MailSearch {
  return Object.fromEntries(
    Object.entries(search).filter(([, value]) => value !== undefined && value !== ""),
  ) as MailSearch;
}

const rowKey = (r: { account: string; threadId: string }) => `${r.account}|${r.threadId}`;

/** "Jane Doe <j@x>, k@y" → "Jane Doe", for "To:" in Sent. */
function firstName(header: string): string {
  const first = header.split(",")[0] ?? "";
  const name = first
    .replace(/<[^>]+>/, "")
    .replace(/"/g, "")
    .trim();
  return name || (/<([^>]+)>/.exec(first)?.[1] ?? first).trim();
}

export function MailApp({ search }: { search: MailSearch }) {
  const navigate = useNavigate({ from: "/email" });
  const queryClient = useQueryClient();
  const google = useGoogleStatus();
  const accounts = useMemo(
    () =>
      (google.data?.accounts ?? []).filter(
        (a): a is typeof a & { email: string } => a.gmail && Boolean(a.email),
      ),
    [google.data?.accounts],
  );

  const folder: FolderId = search.folder ?? "inbox";
  const q = search.q?.trim() ?? "";
  const category = folder === "inbox" && !q ? (search.cat ?? "primary") : undefined;
  const scope = useMemo(
    () =>
      search.account && accounts.some((a) => a.email === search.account)
        ? [search.account]
        : accounts.map((a) => a.email),
    [accounts, search.account],
  );
  const accountInfo = (email: string) => accounts.find((a) => a.email === email);

  const go = (patch: SearchPatch, replace = false) =>
    void navigate({ search: (prev: MailSearch) => withoutEmpty({ ...prev, ...patch }), replace });

  // ---- list ---------------------------------------------------------------

  const listKey = ["mail", "list", scope.join(","), folder, category ?? "", q] as const;
  const list = useInfiniteQuery({
    queryKey: listKey,
    enabled: scope.length > 0,
    initialPageParam: null as Record<string, string | null> | null,
    queryFn: async ({ pageParam }): Promise<Page> => {
      const targets = scope.filter((email) => !pageParam || typeof pageParam[email] === "string");
      const results = await Promise.all(
        targets.map(async (email) => {
          try {
            const page = await listPage(email, {
              folder,
              category,
              q: q || undefined,
              pageToken: pageParam?.[email] ?? undefined,
            });
            return { email, page };
          } catch (error) {
            return { email, error: error instanceof Error ? error.message : "Could not load." };
          }
        }),
      );
      const page: Page = { items: [], tokens: {}, errors: {} };
      for (const email of scope) page.tokens[email] = null;
      for (const r of results) {
        if ("page" in r && r.page) {
          page.items.push(...r.page.items);
          page.tokens[r.email] = r.page.nextPageToken ?? null;
        } else if ("error" in r && r.error) {
          page.errors[r.email] = r.error;
        }
      }
      return page;
    },
    getNextPageParam: (last) =>
      Object.values(last.tokens).some(Boolean) ? last.tokens : undefined,
    staleTime: 30_000,
  });

  const rows = useMemo(
    () => groupThreads(list.data?.pages.flatMap((p) => p.items) ?? []),
    [list.data],
  );
  const errors = Object.entries(list.data?.pages[0]?.errors ?? {});

  // ---- counts -------------------------------------------------------------

  const counts = useQueries({
    queries: scope.map((email) => ({
      queryKey: ["mail", "counts", email],
      queryFn: () => fetchCounts(email).then((d) => d.counts),
      staleTime: 60_000,
    })),
  });
  const total = (key: "inbox" | "drafts" | "spam") =>
    counts.reduce((n, c) => n + (c.data?.[key] ?? 0), 0);

  // ---- open conversation ---------------------------------------------------

  const openAccount = search.in && search.thread ? search.in : null;
  const thread = useQuery({
    queryKey: ["mail", "thread", openAccount, search.thread],
    enabled: Boolean(openAccount && search.thread),
    queryFn: () => fetchThread(openAccount ?? "", search.thread ?? "").then((d) => d.thread),
    staleTime: 15_000,
  });

  const patchRows = (match: (r: MailSummary) => boolean, change: Partial<MailSummary> | "remove") =>
    queryClient.setQueriesData<InfiniteData<Page>>({ queryKey: ["mail", "list"] }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items:
                change === "remove"
                  ? p.items.filter((i) => !match(i))
                  : p.items.map((i) => (match(i) ? { ...i, ...change } : i)),
            })),
          }
        : data,
    );

  // Opening marks it read on the server (when allowed); match the list to it.
  useEffect(() => {
    const t = thread.data;
    if (!t || !accountInfo(t.account)?.canModify) return;
    patchRows((r) => r.account === t.account && r.threadId === t.id, { unread: false });
    void queryClient.invalidateQueries({ queryKey: ["mail", "counts", t.account] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.data?.id]);

  // ---- actions ------------------------------------------------------------

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [folder, category, q, search.account]);

  const reconnect = (email: string) =>
    withBase(`api/google/auth?add=mail&hint=${encodeURIComponent(email)}`);

  async function act(targets: Target[], action: MailAction, opts: { undo?: boolean } = {}) {
    const allowed = targets.filter((t) => accountInfo(t.account)?.canModify);
    const blocked = targets.find((t) => !accountInfo(t.account)?.canModify);
    if (blocked) {
      toast("This account needs one more permission", {
        description: blocked.account,
        action: {
          label: "Allow",
          onClick: () => (window.location.href = reconnect(blocked.account)),
        },
      });
    }
    if (allowed.length === 0) return;
    const keys = new Set(allowed.map(rowKey));
    const hit = (r: MailSummary) => keys.has(rowKey(r));
    const removes =
      action === "trash" ||
      action === "spam" ||
      (action === "archive" && folder === "inbox") ||
      (action === "untrash" && folder === "trash") ||
      (action === "notSpam" && folder === "spam") ||
      (action === "unstar" && folder === "starred") ||
      (action === "notImportant" && folder === "important");
    const change: Partial<MailSummary> | "remove" = removes
      ? "remove"
      : action === "read"
        ? { unread: false }
        : action === "unread"
          ? { unread: true }
          : action === "star"
            ? { starred: true }
            : action === "unstar"
              ? { starred: false }
              : action === "important"
                ? { important: true }
                : action === "notImportant"
                  ? { important: false }
                  : action === "archive"
                    ? { inInbox: false }
                    : action === "inbox"
                      ? { inInbox: true }
                      : {};
    patchRows(hit, change);
    setSelected(new Set());
    const byAccount = new Map<string, string[]>();
    for (const t of allowed)
      byAccount.set(t.account, [...(byAccount.get(t.account) ?? []), t.threadId]);
    try {
      await Promise.all([...byAccount].map(([account, ids]) => modify(account, ids, action)));
      void queryClient.invalidateQueries({ queryKey: ["mail", "counts"] });
      void queryClient.invalidateQueries({ queryKey: ["mail", "thread"] });
      const undoable: Partial<Record<MailAction, MailAction>> = {
        archive: "inbox",
        trash: "untrash",
        spam: "notSpam",
      };
      const inverse = undoable[action];
      const word = {
        archive: "archived",
        trash: "moved to Trash",
        spam: "marked as spam",
      } as Record<string, string>;
      if (inverse && !opts.undo) {
        toast(
          `${allowed.length === 1 ? "Conversation" : `${allowed.length} conversations`} ${word[action]}.`,
          {
            action: {
              label: "Undo",
              onClick: () => {
                void act(allowed, inverse, { undo: true }).then(() =>
                  queryClient.invalidateQueries({ queryKey: ["mail", "list"] }),
                );
              },
            },
          },
        );
      }
    } catch (error) {
      toast.error("That did not work", {
        description: error instanceof Error ? error.message : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["mail", "list"] });
    }
  }

  const selectedTargets = (): Target[] =>
    rows
      .filter((r) => selected.has(rowKey(r)))
      .map((r) => ({ account: r.account, threadId: r.threadId }));

  // ---- compose --------------------------------------------------------------

  const senders = accounts.filter((a) => a.canReply).map((a) => a.email);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [composeKey, setComposeKey] = useState(0);
  const startCompose = (draft: Partial<ComposeDraft> = {}) => {
    const account =
      draft.account && senders.includes(draft.account)
        ? draft.account
        : ((search.account && senders.includes(search.account) ? search.account : senders[0]) ??
          "");
    if (!account) {
      const first = accounts[0]?.email;
      toast("Sending needs one more permission", {
        description: first,
        action: first
          ? { label: "Allow", onClick: () => (window.location.href = reconnect(first)) }
          : undefined,
      });
      return;
    }
    setComposeKey((k) => k + 1);
    setCompose({ to: "", cc: "", bcc: "", subject: "", text: "", ...draft, account });
  };
  const forward = (t: ThreadView) => {
    const last = t.messages[t.messages.length - 1];
    if (!last) return;
    startCompose({
      account: t.account,
      subject: /^fwd?:/i.test(t.subject) ? t.subject : `Fwd: ${t.subject}`,
      text: [
        "",
        "",
        "---------- Forwarded message ---------",
        `From: ${last.from}`,
        `Date: ${new Date(last.date).toString()}`,
        `Subject: ${t.subject}`,
        `To: ${last.to}`,
        "",
        last.text,
      ].join("\n"),
    });
  };

  // ---- search box and shortcuts --------------------------------------------

  const [query, setQuery] = useState(q);
  useEffect(() => setQuery(q), [q]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (e.key === "Escape" && !typing && search.thread) {
        go({ thread: undefined, in: undefined });
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c") {
        e.preventDefault();
        startCompose();
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "e" && search.thread && search.in) {
        void act([{ account: search.in, threadId: search.thread }], "archive");
        go({ thread: undefined, in: undefined });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.thread, search.in, senders.join(",")]);

  // ---- render ---------------------------------------------------------------

  const [menuOpen, setMenuOpen] = useState(false);
  const missing = accounts.filter((a) => !a.canModify || !a.canReply);
  const loadingStatus = google.isLoading;

  const sidebar = (
    <nav aria-label="Mail folders" className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={() => {
          setMenuOpen(false);
          startCompose();
        }}
        className="mb-4 ml-2 flex h-14 w-fit items-center gap-3 rounded-[16px] bg-primary-soft px-5 text-[14px] font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_1px_3px_rgba(0,0,0,0.15),0_4px_8px_rgba(0,0,0,0.08)]"
      >
        <Pencil className="size-5" aria-hidden /> Compose
      </button>
      <ul className="space-y-px pr-2">
        {FOLDERS.map((f) => {
          const active = folder === f.id && !q;
          const count =
            f.id === "inbox"
              ? total("inbox")
              : f.id === "drafts"
                ? total("drafts")
                : f.id === "spam"
                  ? total("spam")
                  : 0;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  go({
                    folder: f.id,
                    cat: undefined,
                    q: undefined,
                    thread: undefined,
                    in: undefined,
                  });
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 w-full items-center gap-4 rounded-r-full pl-6 pr-3 text-[13.5px] transition-colors",
                  active
                    ? "bg-primary-soft font-semibold text-foreground"
                    : "text-foreground/85 hover:bg-secondary",
                )}
              >
                <f.icon
                  className="size-[18px] shrink-0"
                  strokeWidth={active ? 2.2 : 1.8}
                  aria-hidden
                />
                <span className="flex-1 text-left">{f.label}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      "text-[12px] tabular-nums",
                      f.id === "inbox" || f.id === "spam"
                        ? "font-semibold"
                        : "text-muted-foreground",
                    )}
                  >
                    {count.toLocaleString("en-US")}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mb-1 mt-6 pl-6 text-[12px] font-medium text-muted-foreground">Accounts</p>
      <ul className="space-y-px pr-2">
        <li>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              go({ account: undefined, thread: undefined, in: undefined });
            }}
            className={cn(
              "flex h-8 w-full items-center gap-4 rounded-r-full pl-6 pr-3 text-[13px] transition-colors",
              !search.account
                ? "bg-secondary font-medium"
                : "text-foreground/85 hover:bg-secondary",
            )}
          >
            <Mails className="size-4 shrink-0" aria-hidden /> All inboxes
          </button>
        </li>
        {accounts.map((a) => (
          <li key={a.email}>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                go({ account: a.email, thread: undefined, in: undefined });
              }}
              title={a.email}
              className={cn(
                "flex h-8 w-full items-center gap-3 rounded-r-full pl-6 pr-3 text-[13px] transition-colors",
                search.account === a.email
                  ? "bg-secondary font-medium"
                  : "text-foreground/85 hover:bg-secondary",
              )}
            >
              <Avatar name={a.email} seed={a.email} size={20} />
              <span className="min-w-0 flex-1 truncate text-left">{a.email}</span>
            </button>
          </li>
        ))}
        <li>
          <a
            href={withBase("api/google/auth?add=mail")}
            className="flex h-8 w-full items-center gap-4 rounded-r-full pl-6 pr-3 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Plus className="size-4 shrink-0" aria-hidden /> Add account
          </a>
        </li>
      </ul>
    </nav>
  );

  if (!loadingStatus && accounts.length === 0) {
    return (
      <div className="grid h-[calc(100dvh-113px)] place-items-center sm:h-[calc(100dvh-69px)]">
        <div className="max-w-sm text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary-soft">
            <Mail className="size-6 text-primary" aria-hidden />
          </span>
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Connect your email</h1>
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            Any Gmail or Google school account. Google asks which one, and you can add more than
            one. Once connected, it shows up on every computer you sign in on.
          </p>
          <Button className="mt-5 h-10 gap-1.5 rounded-full px-5" asChild>
            <a href={withBase("api/google/auth?add=mail")}>
              <Plus className="size-4" aria-hidden /> Connect an email
            </a>
          </Button>
        </div>
      </div>
    );
  }

  const open = Boolean(search.thread && search.in);
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
  const someChecked = selected.size > 0;
  const showAccount = scope.length > 1;
  const anyModify = scope.some((e) => accountInfo(e)?.canModify);

  return (
    <div className="flex h-[calc(100dvh-113px)] gap-2 sm:h-[calc(100dvh-69px)]">
      <aside className="hidden w-60 shrink-0 overflow-y-auto pt-1 md:block">{sidebar}</aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0 pt-4">
          <SheetTitle className="sr-only">Mail folders</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* Search */}
        <form
          role="search"
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: query.trim() || undefined, thread: undefined, in: undefined });
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open folders"
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary md:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="relative min-w-0 max-w-3xl flex-1">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search mail"
              aria-label="Search mail"
              className="h-12 w-full rounded-full bg-secondary pl-12 pr-12 text-[15px] outline-none transition-[background,box-shadow] placeholder:text-muted-foreground focus:bg-card focus:shadow-[0_1px_3px_rgba(0,0,0,0.15),0_2px_8px_rgba(0,0,0,0.08)]"
            />
            {q ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => go({ q: undefined, thread: undefined, in: undefined })}
                className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-background/70"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="hidden h-10 gap-1.5 rounded-full px-4 text-[13px] lg:inline-flex"
            asChild
          >
            <a
              href={withBase(
                `ask?${new URLSearchParams({ q: "What's new in my email? Anything I need to act on?" })}`,
              )}
            >
              <Sparkles className="size-4" aria-hidden /> Summarize
            </a>
          </Button>
        </form>

        {/* Panel */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-card shadow-[0_0_0_1px_var(--color-border)]">
          {open ? (
            <ThreadPane
              thread={thread.data}
              loading={thread.isLoading}
              error={thread.error instanceof Error ? thread.error.message : null}
              folder={folder}
              canModify={Boolean(search.in && accountInfo(search.in)?.canModify)}
              canReply={Boolean(search.in && accountInfo(search.in)?.canReply)}
              reconnectHref={reconnect(search.in ?? "")}
              onBack={() => go({ thread: undefined, in: undefined })}
              onAction={(action) => {
                if (!search.in || !search.thread) return;
                void act([{ account: search.in, threadId: search.thread }], action);
                if (["archive", "trash", "spam", "untrash", "notSpam"].includes(action)) {
                  go({ thread: undefined, in: undefined });
                }
              }}
              onForward={forward}
              onSent={() => {
                void queryClient.invalidateQueries({ queryKey: ["mail", "thread"] });
                void queryClient.invalidateQueries({ queryKey: ["mail", "list"] });
              }}
            />
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border/70 px-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allChecked ? true : someChecked ? "mixed" : false}
                  aria-label="Select all"
                  onClick={() => setSelected(allChecked ? new Set() : new Set(rows.map(rowKey)))}
                  className="grid size-9 place-items-center rounded-full hover:bg-secondary"
                >
                  <span
                    className={cn(
                      "grid size-[17px] place-items-center rounded-[3px] border-2",
                      allChecked || someChecked
                        ? "border-foreground bg-foreground text-background"
                        : "border-muted-foreground/60",
                    )}
                  >
                    {allChecked ? (
                      <Check className="size-3" strokeWidth={3.5} />
                    ) : someChecked ? (
                      <Minus className="size-3" strokeWidth={3.5} />
                    ) : null}
                  </span>
                </button>
                {someChecked && anyModify ? (
                  <>
                    <ToolButton
                      label="Archive"
                      onClick={() => void act(selectedTargets(), "archive")}
                    >
                      <Archive className="size-[18px]" />
                    </ToolButton>
                    <ToolButton
                      label="Report spam"
                      onClick={() => void act(selectedTargets(), "spam")}
                    >
                      <OctagonAlert className="size-[18px]" />
                    </ToolButton>
                    <ToolButton
                      label="Move to Trash"
                      onClick={() => void act(selectedTargets(), "trash")}
                    >
                      <Trash2 className="size-[18px]" />
                    </ToolButton>
                    <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                    <ToolButton
                      label="Mark as read"
                      onClick={() => void act(selectedTargets(), "read")}
                    >
                      <MailOpen className="size-[18px]" />
                    </ToolButton>
                    <ToolButton
                      label="Mark as unread"
                      onClick={() => void act(selectedTargets(), "unread")}
                    >
                      <Mail className="size-[18px]" />
                    </ToolButton>
                    <ToolButton label="Star" onClick={() => void act(selectedTargets(), "star")}>
                      <Star className="size-[18px]" />
                    </ToolButton>
                  </>
                ) : (
                  <ToolButton
                    label="Refresh"
                    onClick={() => {
                      void queryClient.invalidateQueries({ queryKey: ["mail"] });
                    }}
                  >
                    <RefreshCw
                      className={cn(
                        "size-[18px]",
                        list.isFetching && !list.isFetchingNextPage && "animate-spin",
                      )}
                    />
                  </ToolButton>
                )}
                <span className="ml-auto pr-3 text-[12px] text-muted-foreground">
                  {someChecked
                    ? `${selected.size} selected`
                    : rows.length > 0
                      ? `${rows.length.toLocaleString("en-US")} conversation${rows.length === 1 ? "" : "s"}${q ? ` matching “${q}”` : ""}`
                      : ""}
                </span>
              </div>

              {/* Category tabs */}
              {category ? (
                <div
                  role="tablist"
                  aria-label="Inbox categories"
                  className="flex shrink-0 overflow-x-auto border-b border-border/70"
                >
                  {CATEGORIES.map((c) => {
                    const active = category === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => go({ cat: c.id === "primary" ? undefined : c.id })}
                        className={cn(
                          "relative flex h-12 min-w-36 items-center gap-3 px-4 text-[13.5px] transition-colors hover:bg-secondary/60",
                          active ? "font-medium text-primary" : "text-muted-foreground",
                        )}
                      >
                        <c.icon className="size-[18px]" aria-hidden />
                        {c.label}
                        {active ? (
                          <span
                            className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-primary"
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {missing.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 bg-primary-soft/40 px-4 py-2 text-[12.5px]">
                  <span className="text-muted-foreground">
                    Allow archiving, starring, read status and sending for
                  </span>
                  {missing.map((a) => (
                    <a
                      key={a.email}
                      href={reconnect(a.email)}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {a.email}
                    </a>
                  ))}
                </div>
              ) : null}

              {errors.length > 0 ? (
                <p
                  role="alert"
                  className="border-b border-border/70 bg-warning-soft px-4 py-2 text-[12.5px] text-warning-strong"
                >
                  {errors.map(([email, message]) => `${email}: ${message}`).join(" · ")}
                </p>
              ) : null}

              {/* Rows */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {list.isLoading || loadingStatus ? (
                  <ul aria-label="Loading">
                    {Array.from({ length: 12 }, (_, i) => (
                      <li
                        key={i}
                        className="flex h-10 items-center gap-4 border-b border-border/50 px-4"
                      >
                        <span className="shimmer h-3 w-40 rounded" />
                        <span className="shimmer h-3 flex-1 rounded" />
                        <span className="shimmer h-3 w-12 rounded" />
                      </li>
                    ))}
                  </ul>
                ) : rows.length === 0 ? (
                  <div className="grid h-full place-items-center px-6 text-center">
                    <div>
                      <p className="text-[15px] font-medium">
                        {q
                          ? "No messages matched your search"
                          : folder === "inbox"
                            ? "You're all caught up"
                            : "Nothing here"}
                      </p>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {q
                          ? "Try different words, or from:, subject: and has:attachment."
                          : "New mail shows up here."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <ul aria-label="Conversations">
                    {rows.map((row) => (
                      <MailRow
                        key={rowKey(row)}
                        row={row}
                        folder={folder}
                        selected={selected.has(rowKey(row))}
                        showAccount={showAccount}
                        canModify={Boolean(accountInfo(row.account)?.canModify)}
                        onSelect={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(rowKey(row))) next.delete(rowKey(row));
                            else next.add(rowKey(row));
                            return next;
                          })
                        }
                        onOpen={() => go({ thread: row.threadId, in: row.account })}
                        onAction={(action) =>
                          void act([{ account: row.account, threadId: row.threadId }], action)
                        }
                      />
                    ))}
                    {list.hasNextPage ? (
                      <li className="flex justify-center py-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 gap-1.5 rounded-full px-5 text-[13px]"
                          disabled={list.isFetchingNextPage}
                          onClick={() => void list.fetchNextPage()}
                        >
                          {list.isFetchingNextPage ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <ArrowRight className="size-4 rotate-90" aria-hidden />
                          )}
                          Older mail
                        </Button>
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {compose ? (
        <Compose
          key={composeKey}
          initial={compose}
          accounts={senders}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            void queryClient.invalidateQueries({ queryKey: ["mail", "list"] });
          }}
        />
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}

function MailRow({
  row,
  folder,
  selected,
  showAccount,
  canModify,
  onSelect,
  onOpen,
  onAction,
}: {
  row: MailThreadRow;
  folder: FolderId;
  selected: boolean;
  showAccount: boolean;
  canModify: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onAction: (action: MailAction) => void;
}) {
  const sender =
    folder === "sent" || folder === "drafts" ? `To: ${firstName(row.to) || "(no one)"}` : row.from;
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const star = (
    <button
      type="button"
      onClick={stop(() => onAction(row.starred ? "unstar" : "star"))}
      disabled={!canModify}
      aria-label={row.starred ? "Starred" : "Not starred"}
      title={row.starred ? "Starred" : "Not starred"}
      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground/70 hover:bg-secondary disabled:cursor-default disabled:hover:bg-transparent"
    >
      <Star
        className={cn("size-[18px]", row.starred && "fill-amber-400 text-amber-400")}
        aria-hidden
      />
    </button>
  );

  return (
    <li
      className={cn(
        "group relative border-b border-border/60 transition-shadow hover:z-10 hover:shadow-[inset_1px_0_0_var(--color-border),inset_-1px_0_0_var(--color-border),0_1px_3px_rgba(0,0,0,0.12)]",
        selected ? "bg-primary-soft/60" : row.unread ? "bg-card" : "bg-secondary/45",
      )}
    >
      {/* Wide screens: Gmail's single line. */}
      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        className="hidden h-10 cursor-pointer items-center pl-1 pr-3 text-[13.5px] md:flex"
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select conversation from ${row.from}`}
          onClick={stop(onSelect)}
          className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-secondary"
        >
          <span
            className={cn(
              "grid size-[16px] place-items-center rounded-[3px] border-2",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground/50",
            )}
          >
            {selected ? <Check className="size-3" strokeWidth={3.5} /> : null}
          </span>
        </button>
        {star}
        <span className={cn("w-52 shrink-0 truncate pl-2 pr-4", row.unread && "font-semibold")}>
          {sender}
          {row.count > 1 ? (
            <span className="ml-1 text-[12px] font-normal text-muted-foreground">{row.count}</span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {row.draft ? <span className="mr-1 text-urgent">Draft</span> : null}
          <span className={row.unread ? "font-semibold" : ""}>{row.subject}</span>
          {row.snippet ? <span className="text-muted-foreground"> - {row.snippet}</span> : null}
        </span>
        {showAccount ? (
          <span className="ml-3 hidden max-w-40 shrink-0 truncate rounded-[4px] bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground lg:inline">
            {row.account}
          </span>
        ) : null}
        <span
          className={cn(
            "ml-3 w-20 shrink-0 text-right text-[12px] tabular-nums",
            canModify && "group-hover:hidden",
            row.unread ? "font-semibold" : "text-muted-foreground",
          )}
        >
          {listDate(row.date)}
        </span>
        {canModify ? (
          <span className="ml-3 hidden shrink-0 items-center group-hover:flex">
            {row.inInbox ? (
              <RowAction label="Archive" onClick={stop(() => onAction("archive"))}>
                <Archive className="size-[17px]" />
              </RowAction>
            ) : null}
            {folder === "trash" ? (
              <RowAction label="Move out of Trash" onClick={stop(() => onAction("untrash"))}>
                <Inbox className="size-[17px]" />
              </RowAction>
            ) : (
              <RowAction label="Delete" onClick={stop(() => onAction("trash"))}>
                <Trash2 className="size-[17px]" />
              </RowAction>
            )}
            <RowAction
              label={row.unread ? "Mark as read" : "Mark as unread"}
              onClick={stop(() => onAction(row.unread ? "read" : "unread"))}
            >
              {row.unread ? <MailOpen className="size-[17px]" /> : <Mail className="size-[17px]" />}
            </RowAction>
          </span>
        ) : null}
      </div>

      {/* Phones: avatar, then sender and date, subject, snippet. */}
      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        className="flex cursor-pointer gap-3 px-3 py-2.5 md:hidden"
      >
        <button
          type="button"
          onClick={stop(onSelect)}
          aria-label="Select"
          className="shrink-0 self-start"
        >
          {selected ? (
            <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-5" />
            </span>
          ) : (
            <Avatar name={row.from} seed={row.fromAddress} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-[14px]", row.unread && "font-semibold")}>
              {sender}
              {row.count > 1 ? (
                <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                  {row.count}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "shrink-0 text-[11.5px]",
                row.unread ? "font-semibold" : "text-muted-foreground",
              )}
            >
              {listDate(row.date)}
            </span>
          </div>
          <p className={cn("truncate text-[13px]", row.unread && "font-semibold")}>{row.subject}</p>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
              {row.snippet}
            </p>
            {star}
          </div>
        </div>
      </div>
    </li>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
    >
      {children}
    </button>
  );
}

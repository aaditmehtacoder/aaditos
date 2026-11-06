/**
 * One conversation, read the way a mail client shows it: earlier messages
 * folded to a line, the newest open, quoted history tucked behind "•••", and
 * Reply / Reply all / Forward at the bottom. Everything is plain text — HTML
 * mail is converted on the server and never rendered here.
 */

import {
  Archive,
  ArrowLeft,
  CalendarPlus,
  Forward,
  Inbox,
  Loader2,
  MailOpen,
  OctagonAlert,
  Paperclip,
  Reply,
  ReplyAll,
  Sparkles,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCapture } from "@/lib/hooks/use-capture";
import {
  avatarColor,
  draft,
  formatSize,
  fullDate,
  sendReply,
  splitQuoted,
  type MailAction,
  type ThreadMessage,
  type ThreadView as Thread,
} from "@/lib/mail/api";
import { cn } from "@/lib/utils";

export function Avatar({ name, seed, size = 40 }: { name: string; seed: string; size?: number }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-medium text-white"
      style={{
        width: size,
        height: size,
        background: avatarColor(seed),
        fontSize: size * 0.42,
      }}
    >
      {letter}
    </span>
  );
}

/** "https://us06web.zoom.us/meeting/register/abc…" → "us06web.zoom.us/meeting/regis…": readable, full link kept. */
function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const shown = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
    return shown.length > 48 ? `${shown.slice(0, 47)}…` : shown;
  } catch {
    return url.length > 48 ? `${url.slice(0, 47)}…` : url;
  }
}

function Linkified({ text }: { text: string }) {
  // Plain-text mail wraps links in <…>; the brackets are noise once it is a link.
  const clean = text.replace(/<(https?:\/\/[^\s>]+)>/g, "$1");
  return (
    <>
      {clean.split(/(https?:\/\/[^\s<>()]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            title={part}
            className="text-primary underline underline-offset-2"
          >
            {linkLabel(part)}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "Jane <j@x>, k@y" → "Jane, k@y", and "me" for the account's own address. */
function people(header: string, self: string): string {
  return (header.match(/"[^"]*"\s*<[^>]+>|[^,]+/g) ?? [])
    .map((part) => {
      const address = (/<([^>]+)>/.exec(part)?.[1] ?? part).trim();
      if (address.toLowerCase() === self.toLowerCase()) return "me";
      const name = part
        .replace(/<[^>]+>/, "")
        .replace(/"/g, "")
        .trim();
      return name || address;
    })
    .filter(Boolean)
    .join(", ");
}

function MessageItem({
  message,
  account,
  open,
  onToggle,
  onReply,
}: {
  message: ThreadMessage;
  account: string;
  open: boolean;
  onToggle: () => void;
  onReply: () => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { fresh, quoted } = splitQuoted(message.text);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 border-b border-border/70 py-3 text-left"
      >
        <Avatar name={message.fromName} seed={message.fromAddress} size={36} />
        <span className="w-40 shrink-0 truncate text-[13.5px] font-semibold">
          {message.fromName}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          {message.snippet}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground">
          {new Date(message.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </button>
    );
  }

  return (
    <article className="border-b border-border/70 py-4">
      <div className="flex items-start gap-3">
        <Avatar name={message.fromName} seed={message.fromAddress} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <button type="button" onClick={onToggle} className="min-w-0 text-left">
              <span className="text-[14px] font-semibold">{message.fromName}</span>{" "}
              <span className="text-[12.5px] text-muted-foreground">
                &lt;{message.fromAddress}&gt;
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
              {fullDate(message.date)} ({relative(message.date)})
              {message.starred ? (
                <Star className="ml-1 size-4 fill-amber-400 text-amber-400" aria-label="Starred" />
              ) : null}
              <button
                type="button"
                onClick={onReply}
                aria-label="Reply"
                title="Reply"
                className="ml-1 grid size-8 place-items-center rounded-full hover:bg-secondary"
              >
                <Reply className="size-4" aria-hidden />
              </button>
            </span>
          </div>
          <p className="truncate text-[12.5px] text-muted-foreground">
            to {people(message.to, account) || "me"}
            {message.cc ? `, cc ${people(message.cc, account)}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 whitespace-pre-wrap break-words pl-0 text-[14px] leading-relaxed md:pl-[52px]">
        {fresh ? (
          <Linkified text={fresh} />
        ) : (
          <span className="text-muted-foreground">(No text)</span>
        )}
        {quoted ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowQuoted((v) => !v)}
              aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"}
              title={showQuoted ? "Hide quoted text" : "Show trimmed content"}
              className="rounded-full bg-secondary px-2 text-[13px] leading-5 text-muted-foreground hover:bg-secondary/70"
            >
              •••
            </button>
            {showQuoted ? (
              <div className="mt-2 border-l-2 border-border pl-3 text-muted-foreground">
                <Linkified text={quoted} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {message.attachments.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2 md:pl-[52px]" aria-label="Attachments">
          {message.attachments.map((a, i) => (
            <li
              key={`${a.filename}-${i}`}
              className="flex items-center gap-2 rounded-[10px] border border-border px-3 py-2 text-[12.5px]"
            >
              <Paperclip className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="max-w-56 truncate">{a.filename}</span>
              <span className="text-muted-foreground">{formatSize(a.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

type ReplyMode = "reply" | "all";

function ReplyBox({
  thread,
  mode,
  canReply,
  reconnectHref,
  onCancel,
  onSent,
}: {
  thread: Thread;
  mode: ReplyMode;
  canReply: boolean;
  reconnectHref: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const last = thread.messages[thread.messages.length - 1];
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 140), 420)}px`;
  }, [text]);

  useEffect(() => box.current?.focus(), []);

  if (!last) return null;
  const replyingTo =
    last.fromAddress.toLowerCase() === thread.account.toLowerCase()
      ? people(last.to, thread.account)
      : last.fromName;

  if (!canReply) {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border p-4 md:ml-[52px]">
        <p className="text-[13px] text-muted-foreground">
          Replying needs one more permission from {thread.account}.
        </p>
        <Button size="sm" className="h-8 rounded-full text-[12.5px]" asChild>
          <a href={reconnectHref}>Allow it</a>
        </Button>
      </div>
    );
  }

  async function write() {
    setBusy("draft");
    try {
      const data = await draft(thread.account, {
        id: last?.id,
        instruction,
        current: text,
      });
      setText(data.text);
      box.current?.focus();
    } catch (e) {
      toast.error("No draft", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!last || !text.trim()) return;
    setBusy("send");
    try {
      const sent = await sendReply(thread.account, last.id, text, mode === "all");
      toast.success("Message sent", { description: [sent.to, sent.cc].filter(Boolean).join(", ") });
      onSent();
    } catch (e) {
      toast.error("Not sent", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 flex gap-3">
      <span className="hidden md:block">
        <Avatar name={thread.account} seed={thread.account} />
      </span>
      <div className="min-w-0 flex-1 rounded-[16px] border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <p className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5 text-[13px] text-muted-foreground">
          {mode === "all" ? (
            <ReplyAll className="size-4" aria-hidden />
          ) : (
            <Reply className="size-4" aria-hidden />
          )}
          <span className="truncate">
            {mode === "all" ? "Reply all to " : ""}
            {replyingTo}
          </span>
        </p>
        <label htmlFor="reply-text" className="sr-only">
          Your reply
        </label>
        <textarea
          id="reply-text"
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy === "send"}
          className="block w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-full px-5 text-[13px]"
            disabled={!text.trim() || busy !== null}
            onClick={() => void send()}
          >
            {busy === "send" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Send
          </Button>
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="What should it say?"
            aria-label="What the reply should say"
            className="h-9 min-w-0 flex-1 rounded-full border border-border bg-background px-3.5 text-[12.5px] outline-none focus:border-foreground/25"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 rounded-full text-[12.5px]"
            disabled={busy !== null}
            onClick={() => void write()}
          >
            {busy === "draft" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            {text.trim() ? "Improve" : "Write it for me"}
          </Button>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Discard reply"
            title="Discard"
            className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ThreadPane({
  thread,
  loading,
  error,
  folder,
  canModify,
  canReply,
  reconnectHref,
  onBack,
  onAction,
  onForward,
  onSent,
}: {
  thread: Thread | undefined;
  loading: boolean;
  error: string | null;
  folder: string;
  canModify: boolean;
  canReply: boolean;
  reconnectHref: string;
  onBack: () => void;
  onAction: (action: MailAction) => void;
  onForward: (thread: Thread) => void;
  onSent: () => void;
}) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [replying, setReplying] = useState<ReplyMode | null>(null);
  const capture = useCapture();
  const [filing, setFiling] = useState(false);

  useEffect(() => {
    setOpened(new Set());
    setReplying(null);
  }, [thread?.id]);

  const last = thread?.messages[thread.messages.length - 1];
  const recipients = last
    ? (last.to.match(/@/g)?.length ?? 0) + (last.cc.match(/@/g)?.length ?? 0)
    : 0;
  const inInbox = thread?.labelIds.includes("INBOX") ?? false;
  const starred = thread?.messages.some((m) => m.starred) ?? false;

  async function file() {
    if (!thread || !last) return;
    setFiling(true);
    const text = [
      thread.subject,
      `From ${last.from}`,
      `Received ${new Date(last.date).toString()}`,
      last.text.slice(0, 4000),
    ].join("\n");
    await capture({ text, sourceLabel: "Gmail" });
    setFiling(false);
  }

  const tool = (label: string, icon: React.ReactNode, action: () => void, show = true) =>
    show ? (
      <button
        type="button"
        onClick={action}
        aria-label={label}
        title={label}
        className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {icon}
      </button>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border/70 px-2">
        {tool("Back to list", <ArrowLeft className="size-[18px]" />, onBack)}
        {canModify && thread ? (
          <>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {inInbox
              ? tool("Archive", <Archive className="size-[18px]" />, () => onAction("archive"))
              : tool("Move to Inbox", <Inbox className="size-[18px]" />, () => onAction("inbox"))}
            {folder === "spam"
              ? tool("Not spam", <Undo2 className="size-[18px]" />, () => onAction("notSpam"))
              : tool("Report spam", <OctagonAlert className="size-[18px]" />, () =>
                  onAction("spam"),
                )}
            {folder === "trash"
              ? tool("Move out of Trash", <Undo2 className="size-[18px]" />, () =>
                  onAction("untrash"),
                )
              : tool("Move to Trash", <Trash2 className="size-[18px]" />, () => onAction("trash"))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {tool("Mark as unread", <MailOpen className="size-[18px]" />, () => onAction("unread"))}
            {tool(
              starred ? "Remove star" : "Star",
              <Star className={cn("size-[18px]", starred && "fill-amber-400 text-amber-400")} />,
              () => onAction(starred ? "unstar" : "star"),
            )}
          </>
        ) : null}
        {thread
          ? tool(
              "Add to planner",
              filing ? (
                <Loader2 className="size-[18px] animate-spin" />
              ) : (
                <CalendarPlus className="size-[18px]" />
              ),
              () => void file(),
            )
          : null}
        <span className="ml-auto truncate pr-2 text-[12px] text-muted-foreground">
          {thread?.account}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-5 md:px-8">
        {error ? (
          <p role="alert" className="text-[13px] text-urgent">
            {error}
          </p>
        ) : loading || !thread ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Opening…
          </p>
        ) : (
          <>
            <h2 className="mb-3 flex flex-wrap items-center gap-2 text-[21px] leading-snug md:pl-[52px]">
              <span className="min-w-0 break-words">{thread.subject}</span>
              {inInbox ? (
                <span className="rounded-[4px] bg-secondary px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
                  Inbox
                </span>
              ) : null}
            </h2>
            {thread.messages.map((message, i) => {
              const isLast = i === thread.messages.length - 1;
              const open = isLast || message.unread || opened.has(message.id);
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  account={thread.account}
                  open={open}
                  onToggle={() =>
                    setOpened((prev) => {
                      const next = new Set(prev);
                      if (next.has(message.id)) next.delete(message.id);
                      else next.add(message.id);
                      return next;
                    })
                  }
                  onReply={() => setReplying("reply")}
                />
              );
            })}
            {replying ? (
              <ReplyBox
                key={replying}
                thread={thread}
                mode={replying}
                canReply={canReply}
                reconnectHref={reconnectHref}
                onCancel={() => setReplying(null)}
                onSent={() => {
                  setReplying(null);
                  onSent();
                }}
              />
            ) : (
              <div className="mt-5 flex flex-wrap gap-2 md:pl-[52px]">
                <Button
                  variant="outline"
                  className="h-9 gap-2 rounded-full px-5 text-[13px]"
                  onClick={() => setReplying("reply")}
                >
                  <Reply className="size-4" aria-hidden /> Reply
                </Button>
                {recipients > 1 ? (
                  <Button
                    variant="outline"
                    className="h-9 gap-2 rounded-full px-5 text-[13px]"
                    onClick={() => setReplying("all")}
                  >
                    <ReplyAll className="size-4" aria-hidden /> Reply all
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="h-9 gap-2 rounded-full px-5 text-[13px]"
                  onClick={() => onForward(thread)}
                >
                  <Forward className="size-4" aria-hidden /> Forward
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One conversation, read the way a mail client shows it: earlier messages
 * folded to a line, the newest open, quoted history tucked behind "•••", and
 * Reply / Reply all / Forward at the bottom. Everything is plain text — HTML
 * mail is converted on the server and never rendered here.
 */

import {
  Archive,
  Download,
  FileText,
  Image as ImageIcon,
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { withBase } from "@/lib/base-path";
import { authHeaders } from "@/lib/compass/client";
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

/** *bold* and _italic_, the way plain-text mail marks them, inside one stretch of text. */
function emphasis(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // *…* may wrap onto a second line in hard-wrapped mail; _…_ needs a word boundary
  // on both sides so snake_case and file_names are left alone.
  const pattern = /\*([^*\n]+(?:\n[^*\n]+)?)\*|(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (m[1] !== undefined) {
      out.push(text.slice(last, m.index), <strong key={`${key}-b${i}`}>{m[1]}</strong>);
    } else {
      out.push(text.slice(last, m.index) + (m[2] ?? ""), <em key={`${key}-i${i}`}>{m[3]}</em>);
    }
    last = pattern.lastIndex;
    i += 1;
  }
  out.push(text.slice(last));
  return out;
}

/** Plain-text mail, readable: links shortened and clickable, *bold* and _italic_ honoured. */
function RichText({ text }: { text: string }) {
  // Plain-text mail wraps links in <…>; the brackets are noise once it is a link.
  const clean = text.replace(/<(https?:\/\/[^\s>]+)>/g, "$1").replace(/\n{3,}/g, "\n\n");
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
          <span key={i}>{emphasis(part, String(i))}</span>
        ),
      )}
    </>
  );
}

/** Where mail clients put the history they quote; folded away until asked for. */
const QUOTES = [
  ".gmail_quote",
  ".gmail_extra",
  "blockquote[type='cite']",
  ".yahoo_quoted",
  ".zmail_extra",
  ".moz-cite-prefix",
  "#appendonsend",
  "#divRplyFwdMsg",
  "#divRplyFwdMsg ~ *",
  "#Signature ~ hr ~ *",
];

/**
 * The frame an HTML email is shown in. No scripts can run (no allow-scripts),
 * the content policy admits only images and inline styles, nothing can be
 * submitted, and links open in a new tab. allow-same-origin without
 * allow-scripts only lets this page measure the frame's height.
 */
function frameDocument(html: string): string {
  const hidden = `body:not(.show-quotes) :is(${QUOTES.join(",")}, .app-quote)`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; form-action 'none'">
<meta name="referrer" content="no-referrer">
<style>
:root{color-scheme:light}
html,body{margin:0;padding:0;background:#fff;color:#1f1f1f}
body{font:14px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:break-word;overflow-x:auto;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto}
a{color:#1a5fd6}
pre{white-space:pre-wrap}
p{margin:0 0 .8em}
blockquote{margin:0 0 0 .5em;padding-left:.9em;border-left:2px solid #dadce0;color:#5f6368}
${hidden}{display:none!important}
</style></head><body>${html}</body></html>`;
}

/**
 * History quoted without a class to find it by (Zoho's "---- on … wrote ----",
 * a bare "On … wrote:"): finds that header line by its text, then marks it
 * and everything after it, at every level up to the body, as quoted.
 */
function markUnlabelledQuote(doc: Document): boolean {
  const header = /^(-{2,}\s*on\s[\s\S]{6,300}wrote\s*-{2,}|on\s[\s\S]{6,300}wrote:)$/i;
  const matches = [...doc.body.querySelectorAll("div, p, span, td, font")].filter((el) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length < 400 && header.test(text);
  });
  let hit = matches[0];
  if (!hit) return false;
  for (const m of matches.slice(1)) if (hit.contains(m)) hit = m;
  let node: Element | null = hit;
  hit.classList.add("app-quote");
  while (node && node !== doc.body) {
    for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
      sib.classList.add("app-quote");
    }
    node = node.parentElement;
  }
  return true;
}

function EmailFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(160);
  const [hasQuote, setHasQuote] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const srcDoc = useMemo(() => frameDocument(html), [html]);

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    setHeight(Math.min(h + 2, 30_000));
  }, []);

  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    setHasQuote(Boolean(doc.querySelector(QUOTES.join(","))) || markUnlabelledQuote(doc));
    measure();
    // Pictures and fonts arrive after load and change the height.
    for (const ms of [200, 700, 1500, 3500]) window.setTimeout(measure, ms);
    try {
      observer.current?.disconnect();
      observer.current = new ResizeObserver(measure);
      observer.current.observe(doc.body);
    } catch {
      /* the timed checks above still apply */
    }
  };

  useEffect(() => () => observer.current?.disconnect(), []);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    doc?.body?.classList.toggle("show-quotes", showQuote);
    measure();
  }, [showQuote, measure]);

  return (
    <div>
      <div className="overflow-hidden rounded-[10px] bg-white dark:p-4">
        <iframe
          ref={frame}
          title="Email"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          onLoad={onLoad}
          style={{ height }}
          className="block w-full border-0 bg-white"
        />
      </div>
      {hasQuote ? (
        <button
          type="button"
          onClick={() => setShowQuote((v) => !v)}
          aria-label={showQuote ? "Hide quoted text" : "Show quoted text"}
          title={showQuote ? "Hide quoted text" : "Show trimmed content"}
          className="mt-2 rounded-full bg-secondary px-2 text-[13px] leading-5 text-muted-foreground hover:bg-secondary/70"
        >
          •••
        </button>
      ) : null}
    </div>
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

/**
 * Types this page opens in a tab. Anything else downloads: an HTML or SVG
 * file opened from here would run as part of this site.
 */
const VIEWABLE =
  /^(application\/pdf|image\/(png|jpe?g|gif|webp|bmp|avif)|text\/plain|audio\/(mpeg|mp4|ogg|wav|webm)|video\/(mp4|webm|ogg|quicktime))$/i;

function AttachmentChip({
  account,
  messageId,
  threadId,
  file,
}: {
  account: string;
  messageId: string;
  threadId: string;
  file: ThreadMessage["attachments"][number];
}) {
  const [busy, setBusy] = useState(false);
  const mime = file.mimeType.toLowerCase();
  const viewable = VIEWABLE.test(mime);
  const Icon =
    mime === "application/pdf" ? FileText : mime.startsWith("image/") ? ImageIcon : Paperclip;

  async function get(download: boolean) {
    const inline = viewable && !download;
    // Opened inside the click, so the browser does not treat it as a pop-up.
    const tab = inline ? window.open("", "_blank") : null;
    setBusy(true);
    try {
      const params = new URLSearchParams({ account, message: messageId });
      if (file.attachmentId) params.set("attachment", file.attachmentId);
      else if (file.partId) params.set("part", file.partId);
      const response = await fetch(withBase(`api/gmail/attachment?${params}`), {
        headers: await authHeaders(),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        if (detail.code === "too_big") {
          const gmail = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${threadId}`;
          if (tab) tab.location.href = gmail;
          else window.open(gmail, "_blank", "noopener");
          return;
        }
        throw new Error(detail.message ?? `Could not open it (${response.status})`);
      }
      // The type is set here, from the allowlist, never taken from the sender.
      const blob = new Blob([await response.arrayBuffer()], {
        type: inline ? mime : "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.filename || "attachment";
        document.body.append(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (error) {
      tab?.close();
      toast.error("Could not open that file", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-stretch overflow-hidden rounded-[10px] border border-border text-[12.5px] transition-colors hover:border-foreground/25">
      <button
        type="button"
        onClick={() => void get(false)}
        disabled={busy}
        title={viewable ? `Open ${file.filename}` : `Download ${file.filename}`}
        className="flex min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-secondary/60"
      >
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Icon
            className={cn(
              "size-4 shrink-0",
              mime === "application/pdf" ? "text-urgent" : "text-muted-foreground",
            )}
            aria-hidden
          />
        )}
        <span className="max-w-56 truncate">{file.filename}</span>
        <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
      </button>
      <button
        type="button"
        onClick={() => void get(true)}
        disabled={busy}
        aria-label={`Download ${file.filename}`}
        title="Download"
        className="grid w-9 shrink-0 place-items-center border-l border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Download className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

function MessageItem({
  message,
  account,
  threadId,
  open,
  onToggle,
  onReply,
}: {
  message: ThreadMessage;
  account: string;
  threadId: string;
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
      {message.html ? (
        <div className="mt-3 md:pl-[52px]">
          <EmailFrame html={message.html} />
        </div>
      ) : (
        <div className="mt-3 max-w-[72ch] whitespace-pre-wrap break-words text-[14px] leading-[1.65] md:pl-[52px]">
          {fresh ? (
            <RichText text={fresh} />
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
                  <RichText text={quoted} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {message.attachments.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2 md:pl-[52px]" aria-label="Attachments">
          {message.attachments.map((a, i) => (
            <li key={`${a.filename}-${i}`}>
              <AttachmentChip
                account={account}
                messageId={message.id}
                threadId={threadId}
                file={a}
              />
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
                  threadId={thread.id}
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

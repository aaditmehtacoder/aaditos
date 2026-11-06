/**
 * One email, read in full, with a reply box under it.
 *
 * The message arrives as plain text (HTML mail is converted on the server,
 * never rendered), so nothing in an email can run here. "Write it for me"
 * drafts a reply to edit; Send is the only thing that sends, and it answers
 * whoever wrote, from the account the email arrived in.
 */

import { ExternalLink, KeyRound, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { withBase } from "@/lib/base-path";
import { authHeaders } from "@/lib/compass/client";
import type { InboxItem } from "@/lib/integrations/contracts";

interface MessageView {
  id: string;
  threadId: string;
  account: string;
  subject: string;
  from: string;
  replyTo: string;
  to: string;
  cc: string;
  date: string;
  text: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBase(path), {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; message?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.message ?? `Request failed (${response.status})`);
  }
  return data;
}

/** Links in plain text become links; everything else stays text. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>()]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function EmailReader({
  item,
  canReply,
  onClose,
}: {
  item: InboxItem | null;
  canReply: boolean;
  onClose: () => void;
}) {
  const [message, setMessage] = useState<MessageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessage(null);
    setError(null);
    setReply("");
    setInstruction("");
    setSentTo(null);
    if (!item?.account) return;
    let live = true;
    const params = new URLSearchParams({ account: item.account, id: item.id });
    call<{ message: MessageView }>(`api/gmail/message?${params}`)
      .then((data) => live && setMessage(data.message))
      .catch(
        (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not open it."),
      );
    return () => {
      live = false;
    };
  }, [item]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 120), 360)}px`;
  }, [reply]);

  async function draft() {
    if (!item?.account) return;
    setDrafting(true);
    try {
      const data = await call<{ text: string }>("api/gmail/draft", {
        method: "POST",
        body: JSON.stringify({
          account: item.account,
          id: item.id,
          instruction,
          current: reply,
        }),
      });
      setReply(data.text);
      box.current?.focus();
    } catch (e) {
      toast.error("No draft", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!item?.account || !reply.trim()) return;
    setSending(true);
    try {
      const data = await call<{ to: string }>("api/gmail/reply", {
        method: "POST",
        body: JSON.stringify({ account: item.account, id: item.id, text: reply }),
      });
      setSentTo(data.to);
      setReply("");
      setInstruction("");
      toast.success("Reply sent", { description: `To ${data.to}` });
    } catch (e) {
      toast.error("Not sent", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <div className="border-b border-border px-5 pb-4 pt-5 pr-12">
          <SheetTitle className="text-[17px] font-semibold leading-snug">
            {message?.subject ?? item?.title ?? "Email"}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="mt-2 space-y-0.5 text-[12.5px] text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">{message?.from ?? item?.from}</span>
              </p>
              {message?.to ? <p className="truncate">To {message.to}</p> : null}
              {message?.cc ? <p className="truncate">Cc {message.cc}</p> : null}
              <p>
                {message?.date ?? ""}
                {item?.account ? ` · in ${item.account}` : ""}
              </p>
            </div>
          </SheetDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p role="alert" className="text-[13px] text-urgent">
              {error}
            </p>
          ) : !message ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Opening…
            </p>
          ) : (
            <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
              {message.text ? <Linkified text={message.text} /> : "(This email has no text.)"}
            </div>
          )}
          {item?.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3.5" aria-hidden /> Open in Gmail
            </a>
          ) : null}
        </div>

        <div className="border-t border-border bg-card px-5 py-4">
          {!canReply ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Replying needs one more permission from {item?.account ?? "this account"}.
              </p>
              <Button size="sm" className="h-8 text-[12.5px]" asChild>
                <a
                  href={withBase(
                    `api/google/auth?add=mail&hint=${encodeURIComponent(item?.account ?? "")}`,
                  )}
                >
                  Allow replies
                </a>
              </Button>
            </div>
          ) : sentTo ? (
            <p className="text-[13px] text-success-strong">
              Sent to {sentTo}.{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => setSentTo(null)}
              >
                Write another
              </button>
            </p>
          ) : (
            <div className="space-y-2.5">
              <label htmlFor="reply-box" className="sr-only">
                Your reply
              </label>
              <textarea
                id="reply-box"
                ref={box}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Reply to ${message?.replyTo ?? item?.from ?? "the sender"}…`}
                disabled={!message || sending}
                className="block w-full resize-none rounded-[12px] border border-border bg-background px-3 py-2.5 text-[14px] leading-relaxed outline-none focus:border-foreground/25"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="What should it say? (optional)"
                  aria-label="What the reply should say"
                  disabled={!message || drafting}
                  className="h-8 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-[12.5px] outline-none focus:border-foreground/25"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-[12.5px]"
                  disabled={!message || drafting || sending}
                  onClick={() => void draft()}
                >
                  {drafting ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="size-3.5" aria-hidden />
                  )}
                  {reply.trim() ? "Improve it" : "Write it for me"}
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-[12.5px]"
                  disabled={!message || !reply.trim() || sending}
                  onClick={() => void send()}
                >
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-3.5" aria-hidden />
                  )}
                  Send
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Goes to {message?.replyTo ?? "the sender"} from {item?.account}, in the same thread.
                Nothing sends until you press Send.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

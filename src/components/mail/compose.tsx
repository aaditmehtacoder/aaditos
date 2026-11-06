/**
 * The compose window: bottom-right on a wide screen, full screen on a phone,
 * minimizable to its title bar. "Write it for me" drafts from a few words;
 * Send is the only thing that sends.
 */

import { ChevronDown, Loader2, Maximize2, Minus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { draft, sendNew } from "@/lib/mail/api";
import { cn } from "@/lib/utils";

export interface ComposeDraft {
  account: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
}

export function Compose({
  initial,
  accounts,
  onClose,
  onSent,
}: {
  initial: ComposeDraft;
  /** Accounts that may send. */
  accounts: string[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [mail, setMail] = useState<ComposeDraft>(initial);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showCc, setShowCc] = useState(Boolean(initial.cc || initial.bcc));
  const [instruction, setInstruction] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initial.to) body.current?.focus();
    else toRef.current?.focus();
  }, [initial.to]);

  useLayoutEffect(() => {
    if (expanded) return;
    const el = body.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 220), 380)}px`;
  }, [mail.text, expanded]);

  const set = (patch: Partial<ComposeDraft>) => setMail((m) => ({ ...m, ...patch }));

  async function write() {
    setBusy("draft");
    try {
      const data = await draft(mail.account, {
        instruction,
        current: mail.text,
        to: mail.to,
        subject: mail.subject,
      });
      set({ text: data.text, ...(data.subject && !mail.subject ? { subject: data.subject } : {}) });
      setAsking(false);
      body.current?.focus();
    } catch (e) {
      toast.error("No draft", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!mail.to.trim()) {
      toast.error("Add at least one recipient");
      toRef.current?.focus();
      return;
    }
    if (!mail.text.trim()) {
      toast.error("Write something first");
      return;
    }
    setBusy("send");
    try {
      await sendNew(mail.account, {
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        text: mail.text,
      });
      toast.success("Message sent");
      onSent();
    } catch (e) {
      toast.error("Not sent", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  const title = mail.subject.trim() || "New Message";

  if (minimized) {
    return (
      <div className="fixed bottom-0 right-4 z-40 w-72 overflow-hidden rounded-t-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
        <div className="flex h-10 items-center gap-1 bg-foreground px-3 text-background">
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium"
          >
            {title}
          </button>
          <button
            type="button"
            aria-label="Open"
            onClick={() => setMinimized(false)}
            className="grid size-7 place-items-center rounded hover:bg-background/15"
          >
            <ChevronDown className="size-4 rotate-180" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Discard"
            onClick={onClose}
            className="grid size-7 place-items-center rounded hover:bg-background/15"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  const field =
    "h-10 w-full min-w-0 border-b border-border/70 bg-transparent px-0 text-[13.5px] outline-none placeholder:text-muted-foreground";

  return (
    <>
      {expanded ? (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setExpanded(false)}
          aria-hidden
        />
      ) : null}
      <section
        aria-label="New message"
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-card shadow-[0_8px_30px_rgba(0,0,0,0.22)]",
          expanded
            ? "inset-x-4 inset-y-6 rounded-[14px] md:inset-x-[10%]"
            : "inset-0 md:inset-auto md:bottom-0 md:right-4 md:w-[540px] md:rounded-t-[12px]",
        )}
      >
        <header className="flex h-10 shrink-0 items-center gap-1 bg-secondary px-3">
          <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{title}</h2>
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => setMinimized(true)}
            className="hidden size-7 place-items-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground md:grid"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={expanded ? "Exit full screen" : "Full screen"}
            onClick={() => setExpanded((v) => !v)}
            className="hidden size-7 place-items-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground md:grid"
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Discard and close"
            onClick={onClose}
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col px-4">
          {accounts.length > 1 ? (
            <label className="flex items-center gap-2 border-b border-border/70 text-[13.5px]">
              <span className="text-muted-foreground">From</span>
              <select
                value={mail.account}
                onChange={(e) => set({ account: e.target.value })}
                className="h-10 min-w-0 flex-1 bg-transparent outline-none"
              >
                {accounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="flex items-center gap-2">
            <label htmlFor="compose-to" className="text-[13.5px] text-muted-foreground">
              To
            </label>
            <input
              id="compose-to"
              ref={toRef}
              value={mail.to}
              onChange={(e) => set({ to: e.target.value })}
              placeholder="Recipients"
              autoComplete="email"
              className={field}
            />
            {!showCc ? (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="shrink-0 border-b border-border/70 pb-[11px] pt-[11px] text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                Cc Bcc
              </button>
            ) : null}
          </div>
          {showCc ? (
            <>
              <div className="flex items-center gap-2">
                <label htmlFor="compose-cc" className="text-[13.5px] text-muted-foreground">
                  Cc
                </label>
                <input
                  id="compose-cc"
                  value={mail.cc}
                  onChange={(e) => set({ cc: e.target.value })}
                  className={field}
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="compose-bcc" className="text-[13.5px] text-muted-foreground">
                  Bcc
                </label>
                <input
                  id="compose-bcc"
                  value={mail.bcc}
                  onChange={(e) => set({ bcc: e.target.value })}
                  className={field}
                />
              </div>
            </>
          ) : null}
          <label htmlFor="compose-subject" className="sr-only">
            Subject
          </label>
          <input
            id="compose-subject"
            value={mail.subject}
            onChange={(e) => set({ subject: e.target.value })}
            placeholder="Subject"
            className={field}
          />
          <label htmlFor="compose-body" className="sr-only">
            Message
          </label>
          <textarea
            id="compose-body"
            ref={body}
            value={mail.text}
            onChange={(e) => set({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            className={cn(
              "block w-full resize-none bg-transparent py-3 text-[14px] leading-relaxed outline-none",
              expanded ? "min-h-0 flex-1" : "",
            )}
          />
        </div>

        {asking ? (
          <div className="flex items-center gap-2 border-t border-border/70 px-4 py-2.5">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
            <input
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void write();
                }
                if (e.key === "Escape") setAsking(false);
              }}
              placeholder={
                mail.text.trim() ? "How should it change?" : "What should the email say?"
              }
              aria-label="What the email should say"
              className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            <Button
              size="sm"
              className="h-8 rounded-full text-[12.5px]"
              disabled={busy !== null || (!instruction.trim() && !mail.text.trim())}
              onClick={() => void write()}
            >
              {busy === "draft" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                "Write"
              )}
            </Button>
          </div>
        ) : null}

        <footer className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-2">
          <Button
            className="h-9 gap-1.5 rounded-full px-6 text-[13.5px]"
            disabled={busy !== null}
            onClick={() => void send()}
          >
            {busy === "send" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Send
          </Button>
          <button
            type="button"
            onClick={() => setAsking((v) => !v)}
            aria-label="Write it for me"
            title="Write it for me"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors hover:bg-secondary",
              asking ? "bg-secondary text-foreground" : "text-muted-foreground",
            )}
          >
            <Sparkles className="size-4" aria-hidden /> Write it for me
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Discard draft"
            title="Discard draft"
            className="ml-auto grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </footer>
      </section>
    </>
  );
}

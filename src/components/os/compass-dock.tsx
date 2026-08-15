/**
 * Compass dock — the floating chatbot available on every page.
 *
 * The `/compass` route is the full-height surface; this is the same assistant
 * reachable without leaving what you are doing. It shares `useCompassChat`, so
 * tool handling, proposals and cancellation behave identically in both.
 *
 * Hidden on `/compass` itself, where it would only duplicate the page.
 */

import { Link, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, Loader2, MessageCircle, Send, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CompassAnswer } from "@/components/os/compass-answer";
import { ProposalCard, ToolResultBlock } from "@/components/os/compass-blocks";
import { chord, useModifierKey } from "@/components/os/kbd";
import { Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProviderConfig } from "@/lib/integrations/use-integrations";
import { TOOL_LABEL, useCompassChat } from "@/lib/compass/use-compass-chat";
import { cn } from "@/lib/utils";

const QUICK_PROMPTS = ["What is due this week?", "Plan my afternoon", "What should I do next?"];

export function CompassDock() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { turns, busy, send, stop, reset } = useCompassChat();
  const config = useProviderConfig();
  const configured = config.data?.openai ?? false;

  const modifier = useModifierKey();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ⌘I / Ctrl+I toggles the dock; Escape closes it and returns focus.
  //
  // Not J: that is Quick add, which the palette and both empty states already
  // advertise. Binding both here meant one press opened the dock *and* the
  // Quick add dialog on top of it.
  //
  // Shift and Alt must be clear: Ctrl+Shift+I is the DevTools shortcut, and
  // matching it would toggle the dock every time the console is opened.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "i" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        // On /compass this component renders nothing, so toggling would flip
        // invisible state and surprise you on the next page.
        if (pathname === "/compass") return;
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === "Escape" && open) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pathname]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // The full page already is Compass.
  if (pathname === "/compass") return null;

  const submit = () => {
    const text = input.trim();
    if (!text || busy || !configured) return;
    setInput("");
    void send(text);
  };

  return (
    <>
      {open ? (
        <div
          role="dialog"
          aria-label="Ask Compass"
          className={cn(
            // `rise` is the shell's own arrival motion, so the dock enters the
            // same way every other panel does — and inherits reduce-motion.
            "rise fixed z-30 flex flex-col overflow-hidden rounded-[14px] border border-border bg-card shadow-xl",
            "inset-x-3 bottom-[76px] max-h-[70vh]",
            "sm:inset-x-auto sm:right-5 sm:bottom-[84px] sm:w-[390px] sm:max-h-[560px]",
            "lg:bottom-20",
          )}
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Sparkles className="size-[15px] text-primary" aria-hidden />
            <p className="text-[13px] font-semibold">Compass</p>
            {configured && config.data?.openaiModel ? (
              <Pill tone="neutral">{config.data.openaiModel}</Pill>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {turns.length > 0 ? (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={reset}>
                  Clear
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label="Close Compass"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <X className="size-[14px]" aria-hidden />
              </Button>
            </div>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {!config.isLoading && !configured ? (
              <div className="rounded-[11px] border border-border bg-secondary/40 p-3">
                <p className="text-[12.5px] text-muted-foreground">
                  Compass needs <code className="rounded bg-secondary px-1">OPENAI_API_KEY</code>{" "}
                  set on the server. Everything else in AaditOS works without it.
                </p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-[12px]" asChild>
                  <Link to="/integrations" onClick={() => setOpen(false)}>
                    Integration setup
                  </Link>
                </Button>
              </div>
            ) : null}

            {turns.length === 0 ? (
              <div>
                <p className="text-[12.5px] text-muted-foreground">
                  Ask about your day. Compass reads your real tasks and calendar, and only ever
                  proposes changes for you to confirm.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={!configured || busy}
                      onClick={() => void send(prompt)}
                      className="rounded-[9px] border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:border-foreground/20 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn) =>
                turn.role === "user" ? (
                  <div key={turn.id} className="flex justify-end">
                    <p className="max-w-[85%] rounded-[11px] bg-secondary px-2.5 py-1.5 text-[12.5px]">
                      {turn.text}
                    </p>
                  </div>
                ) : (
                  <article key={turn.id} className="space-y-2">
                    {turn.tools.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {turn.tools.map((tool, i) => (
                          <li key={`${tool.name}-${i}`}>
                            <Pill tone={tool.done ? "neutral" : "primary"}>
                              {tool.done ? null : (
                                <Loader2 className="size-3 animate-spin" aria-hidden />
                              )}
                              {TOOL_LABEL[tool.name] ?? tool.name}
                            </Pill>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {turn.tools
                      .filter((tool) => tool.done && tool.data)
                      .map((tool, i) => (
                        <ToolResultBlock
                          key={`${tool.name}-block-${i}`}
                          name={tool.name}
                          data={tool.data}
                        />
                      ))}

                    {turn.text ? (
                      <CompassAnswer text={turn.text} className="text-[12.5px]" />
                    ) : null}

                    {turn.proposals.map((proposal, i) => (
                      <ProposalCard key={`proposal-${i}`} proposal={proposal} />
                    ))}

                    {turn.error ? (
                      <p className="flex items-start gap-1.5 rounded-[10px] border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[12px] text-destructive">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{turn.error.message}</span>
                      </p>
                    ) : null}

                    {turn.streaming && !turn.text ? (
                      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                        Thinking…
                      </p>
                    ) : null}
                  </article>
                ),
              )
            )}
          </div>

          <div className="border-t border-border p-2.5">
            <div className="flex items-end gap-1.5">
              <label className="sr-only" htmlFor="compass-dock-input">
                Ask Compass
              </label>
              <Textarea
                id="compass-dock-input"
                ref={inputRef}
                rows={1}
                value={input}
                disabled={!configured}
                placeholder={configured ? "Ask Compass…" : "Compass is not configured"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                className="max-h-24 min-h-9 resize-none py-2 text-[12.5px]"
              />
              {busy ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="size-9 shrink-0 p-0"
                  aria-label="Stop generating"
                  onClick={stop}
                >
                  <Square className="size-[13px]" aria-hidden />
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="size-9 shrink-0 p-0"
                  aria-label="Send to Compass"
                  disabled={!input.trim() || !configured}
                  onClick={submit}
                >
                  <Send className="size-[14px]" aria-hidden />
                </Button>
              )}
            </div>
            {/* The shortcut is stated here, not only in the trigger's title
                attribute — a tooltip never appears on a touchscreen. */}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              <Link to="/compass" onClick={() => setOpen(false)} className="underline">
                Open full Compass
              </Link>{" "}
              · Enter to send · {chord(modifier, "I")} to toggle
            </p>
          </div>
        </div>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        aria-label="Ask Compass"
        aria-expanded={open}
        title={`Ask Compass (${chord(modifier, "I")})`}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "fixed z-30 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "right-4 bottom-[68px] lg:right-5 lg:bottom-5",
        )}
      >
        {open ? (
          <X className="size-[19px]" aria-hidden />
        ) : (
          <MessageCircle className="size-[19px]" aria-hidden />
        )}
      </button>
    </>
  );
}

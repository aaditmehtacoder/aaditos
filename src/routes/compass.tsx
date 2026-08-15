import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { AlertTriangle, KeyRound, Loader2, Send, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { CompassAnswer } from "@/components/os/compass-answer";
import { ProposalCard, ToolResultBlock } from "@/components/os/compass-blocks";
import { EmptyState, Panel, PanelHeader, Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProviderConfig } from "@/lib/integrations/use-integrations";
import { TOOL_LABEL, useCompassChat } from "@/lib/compass/use-compass-chat";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/compass")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Compass · AaditOS" },
      { name: "description", content: "Ask Compass to plan, summarize and prepare your day." },
    ],
  }),
  component: CompassPage,
});

const SUGGESTIONS = [
  "Plan my afternoon",
  "What is due this week?",
  "What should I do for the next 45 minutes?",
  "Summarize what I missed",
  "Find scheduling conflicts",
  "Prepare me for tomorrow",
  "Why is the Origami Prep project at risk?",
];

function CompassPage() {
  const search = useSearch({ from: "/compass" });
  const config = useProviderConfig();
  const { turns, busy, send, stop } = useCompassChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  const configured = config.data?.openai ?? false;

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void send(text);
  };

  useEffect(() => {
    if (seeded.current || !search.q) return;
    seeded.current = true;
    setInput(search.q);
  }, [search.q]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  return (
    // dvh: this is the one page that is a composer, so it is the one page the
    // Chromebook's on-screen keyboard is guaranteed to shrink.
    // Measured, not guessed: top bar 53 + main's 20/20 padding = 93, plus the
    // 52px bottom nav below lg.
    <div className="mx-auto flex h-[calc(100dvh-145px)] max-w-[900px] flex-col lg:h-[calc(100dvh-93px)]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="display text-[23px]">Compass</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Reads your real tasks, assignments and calendar. Proposes — never saves on its own.
          </p>
        </div>
        {config.isLoading ? null : configured ? (
          <Pill tone="success" title={`Model: ${config.data?.openaiModel ?? "unknown"}`}>
            {config.data?.openaiModel}
          </Pill>
        ) : (
          <Pill tone="warning">Not configured</Pill>
        )}
      </div>

      {!config.isLoading && !configured ? (
        <Panel className="mb-4">
          <PanelHeader title="Compass needs an OpenAI key" />
          <div className="px-4 py-4">
            <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Set <code className="rounded bg-secondary px-1">OPENAI_API_KEY</code> on the server
                (and optionally <code className="rounded bg-secondary px-1">OPENAI_MODEL</code>) to
                turn Compass on. Everything else in AaditOS works without it — no fake answers are
                generated in the meantime.
              </span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-8 text-[12.5px]" asChild>
                <Link to="/integrations">Integration setup</Link>
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" asChild>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Get an API key
                </a>
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {turns.length === 0 ? (
          <Panel>
            <EmptyState
              icon={Sparkles}
              title="Ask Compass anything about your day"
              description="Compass calls typed, read-only tools over your workspace before it answers, and shows the numbers it used."
            />
            <div className="border-t border-border p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Try</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={!configured || busy}
                    onClick={() => void send(suggestion)}
                    className="rounded-[9px] border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:border-foreground/20 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        ) : (
          turns.map((turn) =>
            turn.role === "user" ? (
              <div key={turn.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-[12px] bg-secondary px-3 py-2 text-[13px]">
                  {turn.text}
                </p>
              </div>
            ) : (
              <article key={turn.id} className="space-y-2.5">
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
                  <CompassAnswer text={turn.text} className="text-[13px]" />
                ) : turn.streaming && turn.tools.length === 0 ? (
                  <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Thinking…
                  </p>
                ) : null}

                {turn.proposals.map((proposal, i) => (
                  <ProposalCard key={`${turn.id}-proposal-${i}`} proposal={proposal} />
                ))}

                {turn.error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-[12px] border border-urgent/30 bg-urgent-soft px-3 py-2.5 text-[12.5px] text-urgent"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      {turn.error.message}
                      {turn.error.retryable ? (
                        <button
                          type="button"
                          className="ml-2 underline underline-offset-2"
                          onClick={() => {
                            const previous = turns.find(
                              (t, i) => turns[i + 1]?.id === turn.id && t.role === "user",
                            );
                            if (previous) void send(previous.text);
                          }}
                        >
                          Retry
                        </button>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </article>
            ),
          )
        )}
      </div>

      <form
        className="border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <label htmlFor="compass-input" className="sr-only">
            Ask Compass
          </label>
          <Textarea
            id="compass-input"
            rows={1}
            value={input}
            disabled={!configured}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              configured
                ? "Ask Compass… (Enter to send, Shift+Enter for a new line)"
                : "Compass is not configured"
            }
            className="max-h-32 min-h-[38px] resize-none text-[13px]"
          />
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-9 shrink-0"
              aria-label="Stop generating"
              onClick={stop}
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="size-9 shrink-0"
              disabled={!configured || !input.trim()}
              aria-label="Send to Compass"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Compass sends your question and a summary of your workspace to OpenAI with{" "}
          <code className="rounded bg-secondary px-1">store: false</code>. It cannot email, message,
          delete or spend anything.
        </p>
      </form>
    </div>
  );
}

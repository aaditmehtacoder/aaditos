import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, KeyRound, Loader2, Send, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CompassAnswer } from "@/components/os/compass-answer";
import { ProposalCard, ToolResultBlock } from "@/components/os/compass-blocks";
import { EmptyState, Panel, PanelHeader, Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProviderConfig } from "@/lib/integrations/use-integrations";
import { TOOL_LABEL, useCompassChat } from "@/lib/compass/use-compass-chat";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask · AaditOS" },
      { name: "description", content: "Ask about your day, your classes and what to do next." },
    ],
  }),
  component: AskPage,
});

const SUGGESTIONS = [
  "What should I do right now?",
  "What is due this week?",
  "Plan my afternoon",
  "What did I write about English?",
  "Am I double-booked this week?",
];

function AskPage() {
  const config = useProviderConfig();
  const { turns, busy, send, stop } = useCompassChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const configured = config.data?.openai ?? false;

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void send(text);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  return (
    // dvh: this is the one page that is a composer, so it is the one page a
    // Chromebook's on-screen keyboard is guaranteed to shrink. Measured, not
    // guessed: top bar 53 + main's 20/20 padding = 93, plus the 52px bottom nav
    // below the sm breakpoint.
    <div className="flex h-[calc(100dvh-145px)] flex-col sm:h-[calc(100dvh-93px)]">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">Ask</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Reads your real tasks, classes, calendar and notes before it answers.
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
          <PanelHeader title="This needs an OpenAI key" />
          <div className="px-4 py-4">
            <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Set <code className="rounded bg-secondary px-1">OPENAI_API_KEY</code> on the server
                to turn this on. Everything else works without it, and nothing is faked in the
                meantime.
              </span>
            </p>
          </div>
        </Panel>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {turns.length === 0 ? (
          <Panel>
            <EmptyState
              icon={Sparkles}
              title="Ask anything about your day"
              description="It calls typed, read-only tools over your own workspace first, and shows the numbers it used."
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
          <label htmlFor="ask-input" className="sr-only">
            Ask a question
          </label>
          <Textarea
            id="ask-input"
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
            placeholder={configured ? "Ask anything…" : "Not configured"}
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
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Your question and a summary of your workspace go to OpenAI with{" "}
          <code className="rounded bg-secondary px-1">store: false</code>. It cannot email, message,
          delete or spend anything.
        </p>
      </form>
    </div>
  );
}

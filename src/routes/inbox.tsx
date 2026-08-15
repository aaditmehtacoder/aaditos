import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  Check,
  ClipboardPaste,
  Inbox as InboxIcon,
  Loader2,
  MapPin,
  Quote,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AuthGate } from "@/components/os/auth-gate";
import { EmptyState, Panel, PanelHeader, PageIntro, Pill } from "@/components/os/primitives";
import { ProviderLogo } from "@/components/os/provider-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { clientId } from "@/lib/compass/client";
import { APP_TZ, formatDuration, formatTime, relativeDayLabel } from "@/lib/core/time";
import type { ExtractedItem, InboxMessage } from "@/lib/integrations/contracts";
import { useOS } from "@/lib/store";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox · AaditOS" },
      {
        name: "description",
        content: "Turn club and school email into dated tasks and calendar events.",
      },
    ],
  }),
  component: () => (
    <AuthGate>
      <InboxPage />
    </AuthGate>
  ),
});

/** The email the user pasted, so the extractor can anchor relative dates. */
interface PastedSource {
  subject: string;
  from: string;
  receivedAt: string;
}

interface ExtractResponse {
  ok: boolean;
  items?: ExtractedItem[];
  note?: string;
  message?: string;
  source?: PastedSource;
}

interface InboxResponse {
  ok: boolean;
  connected: boolean;
  configured: boolean;
  query: string;
  messages: InboxMessage[];
  error?: string;
}

function InboxPage() {
  const { createTask, captureEvent } = useOS();

  const [gmail, setGmail] = useState<InboxResponse | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);

  const [pasted, setPasted] = useState("");
  const [subject, setSubject] = useState("");
  const [items, setItems] = useState<ExtractedItem[] | null>(null);
  const [source, setSource] = useState<PastedSource | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [extractBusy, setExtractBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Keyed by item index, so a confirmed row shows what actually happened to it. */
  const [saved, setSaved] = useState<Record<number, string>>({});

  const googleConnected = gmail?.connected ?? false;

  const loadGmail = useCallback(async () => {
    setGmailBusy(true);
    try {
      const response = await fetch("/api/inbox");
      setGmail((await response.json()) as InboxResponse);
    } catch {
      setGmail(null);
      setError("Could not reach the server.");
    } finally {
      setGmailBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadGmail();
  }, [loadGmail]);

  async function extract(payload: Record<string, unknown>, key: string) {
    setExtractBusy(key);
    setError(null);
    setNote(null);
    setSaved({});
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, timezone: APP_TZ, clientId: clientId() }),
      });
      const data = (await response.json()) as ExtractResponse;
      if (!data.ok) {
        setError(data.message ?? "Extraction failed.");
        setItems(null);
        return;
      }
      setItems(data.items ?? []);
      setSource(data.source ?? null);
      setNote(data.note ?? null);
    } catch {
      setError("Could not reach the server.");
      setItems(null);
    } finally {
      setExtractBusy(null);
    }
  }

  /**
   * Confirming one item does two things: it saves inside AaditOS, and — for a
   * timed event with Google connected — it also writes to Google Calendar, so
   * the calendar the user already lives in actually changes.
   */
  async function confirm(item: ExtractedItem, index: number) {
    const ref = `email:${source?.subject ?? "pasted"}:${item.title}:${item.startAt ?? item.dueAt ?? ""}`;

    if (item.kind === "task") {
      const created = await createTask({
        title: item.title,
        description: item.description,
        category: item.category,
        dueAt: item.dueAt ?? item.startAt,
        dueAllDay: item.allDay,
        priority: item.priority,
        estimateMin: item.estimateMin,
        notes: item.evidence ? `From email: “${item.evidence}”` : undefined,
        source: "gmail",
        sourceRef: ref,
      });
      if (!created) return;
      setSaved((s) => ({ ...s, [index]: "Added to Tasks" }));
      toast.success("Task added", { description: created.title });
      return;
    }

    if (!item.startAt) return;
    const event = await captureEvent({
      title: item.title,
      description: item.description,
      location: item.location,
      startAt: item.startAt,
      endAt: item.endAt,
      allDay: item.allDay,
      kind: "meeting",
      source: "gmail",
      sourceRef: ref,
    });
    if (!event) {
      setError(`Could not save “${item.title}”.`);
      return;
    }

    if (!googleConnected) {
      setSaved((s) => ({ ...s, [index]: "Added to AaditOS" }));
      toast.success("Event added", {
        description: "Connect Google in Integrations to also add it to Google Calendar.",
      });
      return;
    }

    const response = await fetch("/api/google/calendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        description: item.description,
        location: item.location,
        startAt: item.startAt,
        endAt: item.endAt,
        allDay: item.allDay,
        timezone: APP_TZ,
        clientId: clientId(),
      }),
    }).catch(() => null);

    const result = (await response?.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      htmlLink?: string;
    } | null;

    if (result?.ok) {
      setSaved((s) => ({ ...s, [index]: "Added to Google Calendar" }));
      toast.success("Added to Google Calendar", { description: item.title });
    } else {
      // The event is still saved locally — say exactly which half succeeded.
      setSaved((s) => ({ ...s, [index]: "Added to AaditOS only" }));
      toast.warning("Saved here, but Google Calendar refused", {
        description: result?.message ?? "Reconnect Google in Integrations.",
      });
    }
  }

  const pendingCount = useMemo(
    () => (items ?? []).filter((_, i) => !saved[i]).length,
    [items, saved],
  );

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <PageIntro
        title="Inbox"
        description="Paste an email or pull one from Gmail. Compass reads the dates, times and rooms out of it — you confirm each one before anything is saved."
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[12.5px]"
            onClick={() => void loadGmail()}
            disabled={gmailBusy}
          >
            {gmailBusy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            Check Gmail
          </Button>
        }
      />

      <div className="space-y-4">
        <Panel>
          <PanelHeader
            title="Paste an email"
            meta="Works even when Gmail is blocked on a school account"
          />
          <div className="space-y-2.5 p-4">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject (optional)"
              aria-label="Email subject"
              className="h-9 text-[13px]"
            />
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={
                "Paste the whole email here.\n\nOr just write it: robotics club p120 at 4pm"
              }
              aria-label="Email text"
              rows={7}
              className="resize-y text-[13px]"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                Nothing is sent until you press Read it.
              </p>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-[12.5px]"
                disabled={pasted.trim().length < 4 || extractBusy !== null}
                onClick={() =>
                  void extract(
                    { text: pasted.trim(), subject: subject.trim() || undefined },
                    "pasted",
                  )
                }
              >
                {extractBusy === "pasted" ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <ClipboardPaste className="size-3.5" aria-hidden />
                )}
                Read it
              </Button>
            </div>
          </div>
        </Panel>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-urgent/30 bg-urgent-soft px-3.5 py-3 text-[12.5px] text-urgent"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">{error}</span>
          </div>
        ) : null}

        {items ? (
          <Panel>
            <PanelHeader
              title={items.length === 1 ? "1 item found" : `${items.length} items found`}
              meta={source ? source.subject : undefined}
              action={
                pendingCount > 1 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-[12.5px]"
                    onClick={async () => {
                      for (const [i, item] of items.entries()) {
                        if (!saved[i]) await confirm(item, i);
                      }
                    }}
                  >
                    <Check className="size-3.5" aria-hidden />
                    Confirm all {pendingCount}
                  </Button>
                ) : undefined
              }
            />
            {items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={InboxIcon}
                  title="Nothing dated in there"
                  description={note ?? "That message had no meetings, deadlines or shifts to add."}
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item, index) => (
                  <ExtractedRow
                    key={`${item.title}-${item.startAt ?? item.dueAt ?? index}`}
                    item={item}
                    savedAs={saved[index]}
                    googleConnected={googleConnected}
                    onConfirm={() => void confirm(item, index)}
                  />
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="From Gmail"
            meta={
              gmail?.connected && gmail.ok
                ? `${gmail.messages.length} matching · read-only`
                : gmail?.connected
                  ? "Needs reconnecting"
                  : "Not connected"
            }
          />
          {/* Connected but failing is its own state. Showing "no matching mail"
              for a scope error would report a working empty inbox when the real
              answer is that Gmail refused the request. */}
          {gmail?.connected && !gmail.ok ? (
            <div className="p-4">
              <EmptyState
                icon={AlertTriangle}
                title="Gmail refused the request"
                description={
                  gmail.error ??
                  "Google returned an error for this search. Reconnecting usually fixes it."
                }
                action={
                  <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
                    <a href="/integrations">Reconnect Google</a>
                  </Button>
                }
              />
            </div>
          ) : !gmail?.connected ? (
            <div className="p-4">
              <EmptyState
                icon={InboxIcon}
                title="Gmail is not connected"
                description={
                  gmail?.error ??
                  "Connect Google on the Integrations page to pull club and school email in automatically. Pasting above works without it."
                }
                action={
                  <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
                    <a href="/integrations">Open Integrations</a>
                  </Button>
                }
              />
            </div>
          ) : gmail.messages.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={InboxIcon}
                title="No matching mail"
                description="Nothing in the last 30 days matched the club and deadline search."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {gmail.messages.map((message) => (
                <li
                  key={message.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <ProviderLogo id="gmail" className="size-[14px]" />
                      <p className="truncate text-[13px] font-medium">{message.subject}</p>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {message.from} · {relativeDayLabel(message.receivedAt)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground/80">
                      {message.snippet}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 gap-1.5 self-center text-[12.5px]"
                    disabled={extractBusy !== null}
                    onClick={() => void extract({ messageId: message.id }, message.id)}
                  >
                    {extractBusy === message.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="size-3.5" aria-hidden />
                    )}
                    Read it
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ExtractedRow({
  item,
  savedAs,
  googleConnected,
  onConfirm,
}: {
  item: ExtractedItem;
  savedAs: string | undefined;
  googleConnected: boolean;
  onConfirm: () => void;
}) {
  const when = item.startAt ?? item.dueAt;
  const [busy, setBusy] = useState(false);

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={item.kind === "event" ? "primary" : "neutral"}>
            {item.kind === "event" ? "Event" : "Task"}
          </Pill>
          <p className="text-[13.5px] font-medium">{item.title}</p>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Pill tone="neutral">
            <CalendarClock className="size-3" aria-hidden />
            {when
              ? `${relativeDayLabel(when)}${item.allDay ? "" : ` · ${formatTime(when)}`}${
                  item.endAt && !item.allDay ? `–${formatTime(item.endAt)}` : ""
                }`
              : "No date"}
          </Pill>
          {item.location ? (
            <Pill tone="neutral" className="max-w-[240px]">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{item.location}</span>
            </Pill>
          ) : null}
          <Pill
            tone={
              item.priority === "urgent"
                ? "urgent"
                : item.priority === "high"
                  ? "warning"
                  : "neutral"
            }
          >
            {item.priority}
          </Pill>
          <Pill tone="neutral">{formatDuration(item.estimateMin)}</Pill>
        </div>

        {item.description ? (
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">{item.description}</p>
        ) : null}

        {/* The sentence this came from. A wrong time is then traceable rather
            than unexplainable. */}
        {item.evidence ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-muted-foreground/75">
            <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span className="min-w-0 italic">{item.evidence}</span>
          </p>
        ) : null}
      </div>

      {savedAs ? (
        <Pill tone="success" className="mt-1 shrink-0">
          <Check className="size-3" aria-hidden />
          {savedAs}
        </Pill>
      ) : (
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-[12.5px]"
          disabled={busy || (item.kind === "event" && !item.startAt)}
          title={
            item.kind === "event" && googleConnected
              ? "Saves here and adds it to your Google Calendar"
              : "Saves in AaditOS"
          }
          onClick={() => {
            setBusy(true);
            onConfirm();
          }}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : item.kind === "event" && googleConnected ? (
            <CalendarPlus className="size-3.5" aria-hidden />
          ) : (
            <Check className="size-3.5" aria-hidden />
          )}
          Confirm
        </Button>
      )}
    </li>
  );
}

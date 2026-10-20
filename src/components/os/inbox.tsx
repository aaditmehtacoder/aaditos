/**
 * Inbox — what arrived from outside.
 *
 * Emails, Slack mentions, GitHub issues and Notion pages, each with its
 * source's mark. None of it is a task yet. "File" sends the text through
 * capture, which decides whether it is a task, an event or a note, and
 * "Dismiss" makes it go away without a trace. Nothing is auto-filed: an
 * inbox that writes tasks on its own fills the list with other people's
 * priorities.
 */

import { ExternalLink, Inbox as InboxIcon, Loader2, X } from "lucide-react";
import { useState } from "react";

import { EmptyState, Panel, PanelHeader } from "@/components/os/primitives";
import { ProviderMark, type ProviderMarkId } from "@/components/os/provider-marks";
import { Button } from "@/components/ui/button";
import { relativeTimeLabel } from "@/lib/core/time";
import { useCapture } from "@/lib/hooks/use-capture";
import type { InboxItem } from "@/lib/integrations/contracts";
import { useInbox, useProviderConfig } from "@/lib/integrations/use-integrations";

const MARK: Record<InboxItem["source"], ProviderMarkId> = {
  gmail: "gmail",
  github: "github",
  slack: "slack",
  notion: "notion",
};

const LABEL: Record<InboxItem["source"], string> = {
  gmail: "Gmail",
  github: "GitHub",
  slack: "Slack",
  notion: "Notion",
};

function Row({ item, onDismiss }: { item: InboxItem; onDismiss: () => void }) {
  const capture = useCapture();
  const [busy, setBusy] = useState(false);

  async function file() {
    setBusy(true);
    const text = [item.title, item.detail, item.from ? `From ${item.from}` : "", item.url]
      .filter(Boolean)
      .join("\n");
    const outcome = await capture({ text, sourceLabel: LABEL[item.source] });
    setBusy(false);
    if (outcome.ok) onDismiss();
  }

  return (
    <li className="group flex items-start gap-3 px-4 py-2.5">
      <ProviderMark id={MARK[item.source]} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{item.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground">
          {item.from ? <span className="truncate">{item.from}</span> : null}
          {item.from && item.detail ? (
            <span aria-hidden className="opacity-40">
              ·
            </span>
          ) : null}
          {item.detail ? <span className="line-clamp-1 min-w-0">{item.detail}</span> : null}
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="shrink-0">{relativeTimeLabel(item.at)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11.5px]"
          disabled={busy}
          onClick={() => void file()}
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "File"}
        </Button>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open in ${LABEL[item.source]}`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

export function Inbox() {
  const { items, dismiss } = useInbox();
  const config = useProviderConfig();
  const [showAll, setShowAll] = useState(false);

  // Nothing is connected that could feed this: stay out of the way entirely.
  const anySource =
    (config.data?.github || config.data?.slack || config.data?.notion || config.data?.google) ??
    false;
  if (!anySource && items.length === 0) return null;

  const visible = showAll ? items : items.slice(0, 6);

  return (
    <Panel>
      <PanelHeader
        title="Inbox"
        meta={items.length === 0 ? "nothing new" : `${items.length} from your apps`}
        action={
          items.length > 6 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAll ? "Show fewer" : `Show all ${items.length}`}
            </button>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="Nothing waiting"
          description="Emails, mentions, issues and pages from your connected apps land here. File one and it becomes a task, an event or a note."
        />
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((item) => (
            <Row key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

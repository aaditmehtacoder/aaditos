import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Plus, Search, Target, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  KeyValue,
  Panel,
  PanelHeader,
  Pill,
  RowSkeleton,
  Segmented,
} from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { dayDiff, relativeDayLabel } from "@/lib/core/time";
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  type Opportunity,
  type OpportunityStage,
  type OpportunityType,
} from "@/lib/core/types";
import { useOS } from "@/lib/store";

export const Route = createFileRoute("/opportunities")({
  head: () => ({
    meta: [
      { title: "Opportunities · AaditOS" },
      {
        name: "description",
        content: "Internships, hackathons, founder conversations and applications.",
      },
    ],
  }),
  component: OpportunitiesPage,
});

const STAGE_TONE: Record<
  OpportunityStage,
  "neutral" | "primary" | "success" | "warning" | "urgent"
> = {
  discovered: "neutral",
  interested: "neutral",
  applied: "primary",
  follow_up: "warning",
  interview: "primary",
  accepted: "success",
  closed: "neutral",
};

function NewOpportunityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { createOpportunity } = useOS();
  const [org, setOrg] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<OpportunityType>("internship");
  const [stage, setStage] = useState<OpportunityStage>("discovered");
  const [deadline, setDeadline] = useState("");
  const [contact, setContact] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const valid = org.trim().length > 0 && title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">New opportunity</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Track an internship, hackathon, founder conversation, sponsorship or application.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || saving) return;
            setSaving(true);
            void createOpportunity({
              org: org.trim(),
              title: title.trim(),
              type,
              stage,
              contact: contact.trim() || undefined,
              deadlineAt: deadline ? new Date(deadline).toISOString() : undefined,
              nextAction: nextAction.trim() || undefined,
              relatedUrl: url.trim() || undefined,
            })
              .then((created) => {
                if (created) {
                  toast.success("Opportunity added", { description: created.title });
                  onOpenChange(false);
                  setOrg("");
                  setTitle("");
                  setContact("");
                  setNextAction("");
                  setUrl("");
                  setDeadline("");
                }
              })
              .finally(() => setSaving(false));
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opp-org" className="text-[12px]">
                Organization
              </Label>
              <Input
                id="opp-org"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                className="h-9 text-[13px]"
                placeholder="Y Combinator"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-title" className="text-[12px]">
                Opportunity
              </Label>
              <Input
                id="opp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 text-[13px]"
                placeholder="Startup Internship Expo"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as OpportunityType)}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPPORTUNITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {OPPORTUNITY_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Stage</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as OpportunityStage)}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPPORTUNITY_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {OPPORTUNITY_STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-deadline" className="text-[12px]">
                Deadline
              </Label>
              <Input
                id="opp-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="h-9 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-contact" className="text-[12px]">
                Contact
              </Label>
              <Input
                id="opp-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="h-9 text-[13px]"
                placeholder="Jeremy K."
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-next" className="text-[12px]">
              Next action
            </Label>
            <Input
              id="opp-next"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              className="h-9 text-[13px]"
              placeholder="Send the one-pager"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-url" className="text-[12px]">
              Related URL
            </Label>
            <Input
              id="opp-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-9 text-[13px]"
              placeholder="https://"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-[12.5px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 text-[12.5px]"
              disabled={!valid || saving}
            >
              Add opportunity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OpportunityDetail({
  opportunity,
  onClose,
}: {
  opportunity: Opportunity | null;
  onClose: () => void;
}) {
  const { updateOpportunity, deleteOpportunity } = useOS();
  const [notes, setNotes] = useState(opportunity?.notes ?? "");

  if (!opportunity) return null;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-1">
          <SheetTitle className="pr-6 text-[15px] leading-snug">{opportunity.title}</SheetTitle>
          <SheetDescription className="text-[12.5px]">{opportunity.org}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <dl className="divide-y divide-border">
            <KeyValue label="Stage">
              <Select
                value={opportunity.stage}
                onValueChange={(v) =>
                  void updateOpportunity(opportunity.id, {
                    stage: v as OpportunityStage,
                    lastInteractionAt: new Date().toISOString(),
                    lastInteractionNote: `Moved to ${OPPORTUNITY_STAGE_LABELS[v as OpportunityStage]}`,
                  })
                }
              >
                <SelectTrigger className="h-8 text-[12.5px]" aria-label="Stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPPORTUNITY_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {OPPORTUNITY_STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </KeyValue>
            <KeyValue label="Type">{OPPORTUNITY_TYPE_LABELS[opportunity.type]}</KeyValue>
            {opportunity.contact ? (
              <KeyValue label="Contact">{opportunity.contact}</KeyValue>
            ) : null}
            <KeyValue label="Deadline">
              <input
                type="date"
                aria-label="Deadline"
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12.5px]"
                value={opportunity.deadlineAt ? opportunity.deadlineAt.slice(0, 10) : ""}
                onChange={(e) =>
                  void updateOpportunity(opportunity.id, {
                    deadlineAt: e.target.value
                      ? new Date(`${e.target.value}T23:59:00`).toISOString()
                      : undefined,
                  })
                }
              />
            </KeyValue>
            {opportunity.lastInteractionAt ? (
              <KeyValue label="Last touch">
                {relativeDayLabel(opportunity.lastInteractionAt)}
                {opportunity.lastInteractionNote ? ` · ${opportunity.lastInteractionNote}` : ""}
              </KeyValue>
            ) : null}
          </dl>

          <div className="space-y-1.5">
            <Label
              htmlFor="opp-next-action"
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Next action
            </Label>
            <Input
              id="opp-next-action"
              defaultValue={opportunity.nextAction ?? ""}
              className="h-8 text-[12.5px]"
              onBlur={(e) =>
                void updateOpportunity(opportunity.id, { nextAction: e.target.value || undefined })
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="opp-notes"
              className="text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              Notes
            </Label>
            <Textarea
              id="opp-notes"
              value={notes}
              rows={4}
              className="text-[12.5px]"
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[12.5px]"
              disabled={notes === (opportunity.notes ?? "")}
              onClick={() => {
                void updateOpportunity(opportunity.id, { notes: notes || undefined });
                toast.success("Notes saved");
              }}
            >
              Save notes
            </Button>
          </div>

          {opportunity.relatedUrl ? (
            <a
              href={opportunity.relatedUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[12.5px] text-primary underline underline-offset-2"
            >
              Open link <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}

          <div className="border-t border-border pt-4">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12.5px] text-urgent hover:text-urgent"
              onClick={() => {
                void deleteOpportunity(opportunity.id);
                toast.success("Opportunity removed");
                onClose();
              }}
            >
              <Trash2 className="size-3.5" aria-hidden /> Delete
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OpportunitiesPage() {
  const { workspace, status, now, updateOpportunity } = useOS();
  const [layout, setLayout] = useState<"table" | "board">("table");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspace.opportunities.filter((o) => {
      if (type !== "all" && o.type !== type) return false;
      if (!q) return true;
      return (
        o.title.toLowerCase().includes(q) ||
        o.org.toLowerCase().includes(q) ||
        (o.contact ?? "").toLowerCase().includes(q) ||
        (o.nextAction ?? "").toLowerCase().includes(q)
      );
    });
  }, [workspace.opportunities, query, type]);

  const dueSoon = filtered.filter(
    (o) => o.deadlineAt && dayDiff(now, o.deadlineAt) >= 0 && dayDiff(now, o.deadlineAt) <= 14,
  );

  return (
    <div className="mx-auto max-w-[1300px]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="display text-[23px]">Opportunities</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {workspace.opportunities.length} tracked · {dueSoon.length} with a deadline in the next
            two weeks
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-[12.5px]" onClick={() => setDialogOpen(true)}>
          <Plus className="size-3.5" aria-hidden /> New
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-4">
        <Segmented
          label="Layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "table", label: "Table" },
            { value: "board", label: "Board" },
          ]}
        />
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search opportunities"
            aria-label="Search opportunities"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger
            className="h-8 w-auto min-w-[140px] text-[12.5px]"
            aria-label="Type filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {OPPORTUNITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {OPPORTUNITY_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {status === "loading" ? (
        <Panel>
          <RowSkeleton rows={6} />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Target}
            title={query || type !== "all" ? "Nothing matches" : "No opportunities yet"}
            description={
              query || type !== "all"
                ? "Try a different search or clear the type filter."
                : "Track internships, hackathons, founder conversations and applications in one pipeline."
            }
            action={
              <Button size="sm" className="h-8 text-[12.5px]" onClick={() => setDialogOpen(true)}>
                Add the first one
              </Button>
            }
          />
        </Panel>
      ) : layout === "table" ? (
        <Panel>
          <PanelHeader title={`${filtered.length} opportunities`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <caption className="sr-only">
                Opportunities with organization, type, stage, deadline, next action and contact
              </caption>
              <thead>
                <tr className="border-b border-border text-left">
                  {["Opportunity", "Organization", "Type", "Stage", "Deadline", "Next action"].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((opportunity) => {
                  const overdue =
                    opportunity.deadlineAt && dayDiff(now, opportunity.deadlineAt) < 0;
                  return (
                    <tr
                      key={opportunity.id}
                      className="cursor-pointer transition-colors duration-150 hover:bg-muted/50"
                      onClick={() => setSelected(opportunity)}
                    >
                      <td className="px-4 py-2.5 text-[12.5px]">{opportunity.title}</td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                        {opportunity.org}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                        {OPPORTUNITY_TYPE_LABELS[opportunity.type]}
                      </td>
                      <td className="px-4 py-2.5">
                        <Pill tone={STAGE_TONE[opportunity.stage]}>
                          {OPPORTUNITY_STAGE_LABELS[opportunity.stage]}
                        </Pill>
                      </td>
                      <td className="px-4 py-2.5 text-[12px]">
                        {opportunity.deadlineAt ? (
                          <span
                            className={
                              overdue ? "font-medium text-urgent" : "text-muted-foreground"
                            }
                          >
                            {relativeDayLabel(opportunity.deadlineAt, now)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                        {opportunity.nextAction ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1100px] grid-cols-7 gap-3">
            {OPPORTUNITY_STAGES.map((stage) => {
              const items = filtered.filter((o) => o.stage === stage);
              return (
                <section key={stage} className="min-w-0">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="truncate text-[12px] font-medium">
                      {OPPORTUNITY_STAGE_LABELS[stage]}
                    </h2>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {items.map((opportunity) => (
                      <article
                        key={opportunity.id}
                        className="rounded-[12px] border border-border bg-card p-2.5 transition-colors duration-150 hover:border-foreground/20"
                      >
                        <button
                          type="button"
                          onClick={() => setSelected(opportunity)}
                          className="w-full text-left"
                        >
                          <p className="line-clamp-2 text-[12.5px] font-medium">
                            {opportunity.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                            {opportunity.org}
                          </p>
                          {opportunity.deadlineAt ? (
                            <p className="mt-1.5 text-[11px] text-muted-foreground">
                              {relativeDayLabel(opportunity.deadlineAt, now)}
                            </p>
                          ) : null}
                        </button>
                        <div className="mt-2 flex gap-1 border-t border-border pt-2">
                          <StageButton
                            opportunity={opportunity}
                            direction={-1}
                            onMove={(next) =>
                              void updateOpportunity(opportunity.id, { stage: next })
                            }
                          />
                          <StageButton
                            opportunity={opportunity}
                            direction={1}
                            onMove={(next) =>
                              void updateOpportunity(opportunity.id, { stage: next })
                            }
                          />
                        </div>
                      </article>
                    ))}
                    {items.length === 0 ? (
                      <p className="rounded-[12px] border border-dashed border-border px-2.5 py-4 text-center text-[11.5px] text-muted-foreground">
                        Empty
                      </p>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <NewOpportunityDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <OpportunityDetail
        opportunity={
          selected ? (workspace.opportunities.find((o) => o.id === selected.id) ?? null) : null
        }
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function StageButton({
  opportunity,
  direction,
  onMove,
}: {
  opportunity: Opportunity;
  direction: -1 | 1;
  onMove: (stage: OpportunityStage) => void;
}) {
  const index = OPPORTUNITY_STAGES.indexOf(opportunity.stage);
  const target = OPPORTUNITY_STAGES[index + direction];
  const label = direction === -1 ? "Back" : "Advance";

  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && onMove(target)}
      title={
        target
          ? `${label} to ${OPPORTUNITY_STAGE_LABELS[target]}`
          : `Cannot ${label.toLowerCase()} further`
      }
      className="flex-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

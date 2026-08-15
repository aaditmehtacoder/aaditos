import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SOURCE_LABELS } from "@/lib/core/types";
import type { Priority, SourceId } from "@/lib/core/types";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
  as: As = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As
      className={cn(
        "rounded-[14px] border border-border bg-card",
        "transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]",
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}

export function PanelHeader({
  title,
  meta,
  action,
  id,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 id={id} className="truncate text-[13px] font-semibold tracking-tight">
          {title}
        </h2>
        {meta ? <span className="truncate text-[12px] text-muted-foreground">{meta}</span> : null}
      </div>
      {action}
    </div>
  );
}

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Sources worth naming. "manual" and "demo" are noise on every row. */
const QUIET_SOURCES = new Set<SourceId>(["manual", "demo"]);

export function isExternalSource(source: SourceId): boolean {
  return !QUIET_SOURCES.has(source);
}

export function SourceTag({ source, className }: { source: SourceId; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[11px] tracking-tight text-muted-foreground/80",
        className,
      )}
    >
      <span aria-hidden className="size-1 rounded-full bg-muted-foreground/40" />
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

const priorityStyles: Record<Priority, string> = {
  urgent: "bg-urgent",
  high: "bg-warning",
  normal: "bg-primary/60",
  low: "bg-muted-foreground/40",
};

/**
 * Priority as a dot, with the word available to assistive technology and on
 * hover — colour alone never carries the meaning.
 */
export function PriorityDot({
  priority,
  className,
  muted,
}: {
  priority: Priority;
  className?: string;
  muted?: boolean;
}) {
  return (
    <>
      <span
        aria-hidden
        title={`${priority} priority`}
        className={cn(
          "size-1.5 shrink-0 rounded-full transition-opacity duration-[var(--dur-base)]",
          priorityStyles[priority],
          muted && "opacity-40",
          className,
        )}
      />
      <span className="sr-only">{priority} priority</span>
    </>
  );
}

export function Pill({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: "neutral" | "primary" | "success" | "warning" | "urgent" | undefined;
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const tones = {
    neutral: "bg-secondary text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success-strong",
    warning: "bg-warning-soft text-warning-strong",
    urgent: "bg-urgent-soft text-urgent",
  } as const;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-3", className)}>
      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[18px] font-semibold tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 grid size-9 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 grid size-9 place-items-center rounded-full border border-urgent/30 bg-urgent-soft text-urgent">
        <AlertTriangle className="size-4" />
      </div>
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-1 max-w-md text-[12.5px] text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-4 h-8 gap-1.5 text-[12.5px]"
          onClick={onRetry}
        >
          <RefreshCw className="size-3.5" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function RowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="shimmer size-4 shrink-0 rounded-full" />
          <div className="shimmer h-3 flex-1 rounded-full" />
          <div className="shimmer h-3 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function BlockSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer rounded-[14px]", className)} />;
}

export function LoadingRegion({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-8 text-[12.5px] text-muted-foreground"
    >
      <Loader2 className="size-3.5 animate-spin" />
      {label}
    </div>
  );
}

export function OfflineNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-[11.5px] text-muted-foreground", className)}>
      <WifiOff className="size-3" />
      Offline — showing the last data saved on this device.
    </p>
  );
}

/**
 * Accessible text alternative for a chart. Screen readers get the numbers;
 * sighted users can expand the same summary.
 */
export function ChartSummary({ summary, rows }: { summary: string; rows: string[] }) {
  return (
    <details className="group border-t border-border px-4 py-2.5">
      {/* min-h-6 so the disclosure is a 24px touch target, not a 17px line. */}
      <summary className="flex min-h-6 cursor-pointer list-none items-center text-[11.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
        <span className="underline decoration-dotted underline-offset-2">Text summary</span>
      </summary>
      <p className="mt-2 text-[12px] text-muted-foreground">{summary}</p>
      <ul className="mt-1.5 space-y-0.5">
        {rows.map((row) => (
          <li key={row} className="text-[12px] tabular-nums text-muted-foreground">
            {row}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-[10px] border border-border bg-card p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[7px] px-2.5 py-1 text-[12px] transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              active
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 py-1.5">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[12.5px]">{children}</dd>
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  tone = "primary",
}: {
  value: number;
  label: string;
  tone?: "primary" | "success" | "warning" | "urgent";
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const tones = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    urgent: "bg-urgent",
  } as const;
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-200", tones[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

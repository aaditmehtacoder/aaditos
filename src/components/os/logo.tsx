/**
 * AaditOS mark.
 *
 * A single geometric form that reads two ways: an upright **A** with its apex
 * and splayed legs, and a **compass needle** pointing north. That is the whole
 * idea of the product in one shape — it is Aadit's, and it tells you which way
 * to go. It also ties the shell to Compass, the assistant, without repeating
 * a literal compass rose.
 *
 * Drawn on a 24 grid so it stays crisp at 20px in the sidebar and scales up
 * cleanly for the icon set. No text inside the mark, so it never needs a font
 * to render correctly.
 */

import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="7" className="fill-primary" />
      {/*
        Apex at top centre, legs to the lower corners, notched back up to the
        middle. The notch is what makes it read as an A rather than a plain
        triangle, and as a needle rather than a chevron.
      */}
      <path d="M12 5.1 17.4 18.6 12 15.55 6.6 18.6Z" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="group/logo flex items-center gap-2">
      {/* The needle swings a few degrees on hover, the way a real one settles. */}
      <LogoMark className="size-6 transition-transform duration-[190ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/logo:-rotate-6" />
      {!compact ? (
        <span className="text-[13.5px] font-semibold tracking-tight">AaditOS</span>
      ) : null}
    </div>
  );
}

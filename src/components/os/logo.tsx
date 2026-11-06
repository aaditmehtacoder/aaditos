/**
 * The mark: a four-point sparkle on the accent square.
 *
 * Deliberately not a letter or a name. The outline is the same 48-point curve
 * `scripts/generate-icons.mjs` rasterizes for the PWA icons, so the two never
 * drift apart. Drawn on a 24 grid so it stays crisp at 20px.
 */

import { cn } from "@/lib/utils";

const SPARKLE =
  "M19 12 18.86 12.05 18.44 12.27 17.79 12.7 16.96 13.33 16.02 14.13 15.05 15.05 14.13 16.02 13.33 16.96 12.7 17.79 12.27 18.44 12.05 18.86 12 19 11.95 18.86 11.73 18.44 11.3 17.79 10.67 16.96 9.87 16.02 8.95 15.05 7.98 14.13 7.04 13.33 6.21 12.7 5.56 12.27 5.14 12.05 5 12 5.14 11.95 5.56 11.73 6.21 11.3 7.04 10.67 7.98 9.87 8.95 8.95 9.87 7.98 10.67 7.04 11.3 6.21 11.73 5.56 11.95 5.14 12 5 12.05 5.14 12.27 5.56 12.7 6.21 13.33 7.04 14.13 7.98 15.05 8.95 16.02 9.87 16.96 10.67 17.79 11.3 18.44 11.73 18.86 11.95Z";

export function LogoMark({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="7" className="fill-primary" />
      <path d={SPARKLE} className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="group/logo flex items-center">
      {/* A small turn on hover, the way a sparkle catches the light. */}
      <LogoMark className="size-6 transition-transform duration-[190ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/logo:rotate-45" />
    </div>
  );
}

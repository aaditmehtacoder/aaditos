/**
 * Provider marks.
 *
 * Geometry comes from the `simple-icons` project, extracted at build time into
 * `provider-marks.ts` by `bun run marks`. simple-icons is a devDependency, so
 * none of its 3,400 icons reach the browser — only the ten we actually use.
 *
 * Two brands are drawn by hand below because simple-icons does not carry them:
 * OpenAI and LinkedIn both had their marks removed from the project. They use
 * the vendors' own published geometry in the same 24x24 box, so a row of
 * providers stays visually consistent.
 *
 * Colour: each mark renders in its official brand colour. Brands whose colour
 * is near-black (GitHub, Vercel, OpenAI) are flagged `adaptive` and render with
 * `currentColor` instead, so they stay visible in dark mode rather than
 * disappearing into the background.
 *
 * Providers with no brand at all — the school calendar and the district
 * gradebook — fall back to a typographic monogram in the same footprint, so a
 * list never mixes a logo with a hole. The weather feed is the exception: it
 * has no brand but it does have a subject, so it draws a weather icon.
 */

import { CloudSun } from "lucide-react";

import { PROVIDER_MARKS, type ProviderMark } from "@/components/os/provider-marks";
import { cn } from "@/lib/utils";

/** Marks absent from simple-icons, drawn from the vendors' own logo geometry. */
const HAND_DRAWN: Record<string, ProviderMark> = {
  openai: {
    title: "OpenAI",
    hex: "#000000",
    adaptive: true,
    path: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
  },
  linkedin: {
    title: "LinkedIn",
    hex: "#0A66C2",
    adaptive: false,
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
};

/**
 * Providers with no brand mark at all. A school and a district gradebook have
 * no logo simple-icons could carry, so a monogram is the honest answer.
 */
const MONOGRAMS: Record<string, string> = {
  wilcox: "W",
  aeries: "AE",
};

export function markFor(id: string): ProviderMark | undefined {
  return PROVIDER_MARKS[id] ?? HAND_DRAWN[id];
}

export function ProviderLogo({
  id,
  glyph,
  className,
}: {
  id: string;
  /** Registry glyph, used when the provider has no mark of any kind. */
  glyph?: string | undefined;
  className?: string | undefined;
}) {
  const box = cn("size-[18px] shrink-0", className);
  const mark = markFor(id);

  // The weather feed has no brand, but it does have a subject. A real sun beats
  // a degree sign floating in a grey box.
  if (id === "weather") {
    return <CloudSun className={cn(box, "text-muted-foreground")} aria-hidden />;
  }

  if (!mark) {
    const text = MONOGRAMS[id] ?? glyph ?? "?";
    return (
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-[5px] bg-secondary font-semibold tracking-tight text-muted-foreground",
          box,
        )}
        style={{ fontSize: text.length > 1 ? "0.6em" : "0.72em" }}
      >
        {text}
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
      className={box}
      fill={mark.adaptive ? "currentColor" : mark.hex}
    >
      <path d={mark.path} />
    </svg>
  );
}

/**
 * A provider as a chip: real mark, name, hairline border. Quiet enough to sit
 * in a list, legible enough to scan by logo alone.
 */
export function ProviderChip({
  id,
  name,
  glyph,
  className,
}: {
  id: string;
  name: string;
  glyph?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      <ProviderLogo id={id} glyph={glyph} className="size-[15px]" />
      {name}
    </span>
  );
}

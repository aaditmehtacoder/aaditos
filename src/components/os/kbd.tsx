import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The modifier this keyboard actually has.
 *
 * Every shortcut in the app listens for `metaKey || ctrlKey`, so both work
 * everywhere — but the *label* has to match the machine. A Chromebook keyboard
 * has no ⌘ key at all, so printing "⌘K" there names a key the user cannot
 * find.
 *
 * The server has no keyboard to inspect, so it renders "Ctrl": the primary
 * target is a Chromebook, and being right before hydration on the common case
 * beats being right on neither. macOS corrects itself on mount.
 */
export function useModifierKey(): "⌘" | "Ctrl" {
  const [modifier, setModifier] = useState<"⌘" | "Ctrl">("Ctrl");

  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ??
      navigator.platform ??
      "";
    if (/mac/i.test(platform)) setModifier("⌘");
  }, []);

  return modifier;
}

/**
 * A chord as plain text, for prose like "or press Ctrl+J": `⌘J` on a Mac,
 * `Ctrl+J` everywhere else — "⌘K" reads as one chord, "CtrlK" does not.
 */
export function chord(modifier: "⌘" | "Ctrl", key: string): string {
  return modifier === "⌘" ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * A key hint. `<Kbd>K</Kbd>` renders ⌘K or Ctrl+K depending on the keyboard —
 * "⌘K" reads as one chord on a Mac, while "Ctrl+K" needs the separator.
 */
export function Kbd({ children, className }: { children: string; className?: string }) {
  const modifier = useModifierKey();
  return (
    <kbd
      className={cn(
        "rounded border border-border px-1 font-sans text-[10px] leading-[1.6] text-muted-foreground",
        className,
      )}
    >
      {chord(modifier, children)}
    </kbd>
  );
}

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The check pops in rather than appearing, and the box eases to its filled
 * state — the small piece of feedback that makes completing something feel
 * like it landed.
 *
 * The circle is 17px because the rows are dense, but the hit area is not: an
 * `::after` overlay stretches it to a 24px square — the WCAG 2.2 minimum, and
 * the difference between a checkbox you can tick with a fingertip on a
 * touchscreen Chromebook and one you keep missing. The overlay is absolutely
 * positioned, so nothing in the row moves.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer relative grid size-[17px] shrink-0 cursor-pointer place-content-center rounded-full border border-foreground/25",
      "after:absolute after:left-1/2 after:top-1/2 after:size-6 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
      "transition-[background-color,border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out-soft)]",
      "hover:border-primary/70 active:scale-90",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
      <Check
        className="size-3 animate-[check-pop_var(--dur-base)_var(--ease-settle)]"
        strokeWidth={3}
      />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

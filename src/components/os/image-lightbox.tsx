import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A picture that opens full size when pressed.
 *
 * `src` null means "still on its way" and shows a spinner in the picture's
 * place. A picture that fails to load calls `onError`, so a caller can hide a
 * link that turned out to be dead instead of showing a broken-image icon.
 */
export function ImageWithLightbox({
  src,
  name,
  className,
  onError,
  inline = false,
}: {
  src: string | null;
  name: string;
  className?: string;
  onError?: () => void;
  /** Rendered inside running text (a markdown paragraph): no block elements. */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!src) {
    return (
      <span className={cn("grid place-items-center bg-secondary", className)}>
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${name}`}
        className={cn("cursor-zoom-in", inline && "inline-block align-top")}
      >
        <img
          src={src}
          alt={name}
          className={className}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={onError}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-3 sm:p-4">
          <DialogTitle className="pr-8 text-[13px] font-medium">{name}</DialogTitle>
          <div className="grid place-items-center">
            <img
              src={src}
              alt={name}
              referrerPolicy="no-referrer"
              className="max-h-[80dvh] w-auto max-w-full rounded-[10px] object-contain"
            />
          </div>
          <div className="flex justify-end">
            <a
              href={src}
              download={name}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
            >
              <Download className="size-3.5" aria-hidden /> Download
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

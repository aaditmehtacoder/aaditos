/**
 * The images on a task or a note: small thumbnails in the row, the full
 * picture in a dialog on tap. Removal is behind the open dialog, not on the
 * thumbnail, so a stray tap in a list cannot delete a photo.
 */

import { ImageOff, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Attachment } from "@/lib/core/types";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

function useAttachmentSrc(attachment: Attachment): { src: string | null; failed: boolean } {
  const { attachmentUrl } = useOS();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    attachmentUrl(attachment)
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [attachment, attachmentUrl]);
  return { src, failed };
}

function Thumb({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const { src, failed } = useAttachmentSrc(attachment);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open image ${attachment.name}`}
      className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-border bg-secondary transition-[border-color] hover:border-foreground/30"
    >
      {failed ? (
        <ImageOff className="size-3.5 text-muted-foreground" aria-hidden />
      ) : src ? (
        <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}

function Full({ attachment }: { attachment: Attachment }) {
  const { src, failed } = useAttachmentSrc(attachment);
  if (failed) {
    return (
      <p className="py-10 text-center text-[12.5px] text-muted-foreground">
        This image is no longer available.
      </p>
    );
  }
  if (!src) {
    return (
      <div className="grid h-60 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={attachment.name}
      width={attachment.width}
      height={attachment.height}
      className="max-h-[75dvh] w-auto max-w-full rounded-[10px] object-contain"
    />
  );
}

export function AttachmentStrip({
  attachments,
  target,
  className,
}: {
  attachments: Attachment[];
  /** What the images belong to, so one can be removed from it. */
  target: { kind: "task" | "note"; id: string };
  className?: string | undefined;
}) {
  const { removeAttachment } = useOS();
  const [open, setOpen] = useState<Attachment | null>(null);
  const [removing, setRemoving] = useState(false);

  if (attachments.length === 0) return null;

  return (
    <>
      <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Images">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <Thumb attachment={attachment} onOpen={() => setOpen(attachment)} />
          </li>
        ))}
      </ul>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-w-3xl p-3 sm:p-4">
          {open ? (
            <>
              <DialogTitle className="pr-8 text-[13px] font-medium">{open.name}</DialogTitle>
              <div className="grid place-items-center">
                <Full attachment={open} />
              </div>
              <div className="flex items-center justify-between gap-3 text-[11.5px] text-muted-foreground">
                <span>
                  {open.width}×{open.height} · {Math.round(open.size / 1024)} KB
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-[12px] text-urgent hover:bg-urgent-soft hover:text-urgent"
                  disabled={removing}
                  onClick={() => {
                    setRemoving(true);
                    void removeAttachment(target, open.id).finally(() => {
                      setRemoving(false);
                      setOpen(null);
                    });
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden /> Remove
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

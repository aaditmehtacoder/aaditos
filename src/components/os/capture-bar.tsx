/**
 * One box for everything.
 *
 * Keeping a todo list is hard because the list only accepts todos. What
 * actually needs remembering arrives as "fin lit packet friday", as a club
 * email with four dates buried in it, as a photo of the assignment sheet —
 * or as "Robson wants the thesis arguable", which is not a task at all.
 * Anything that makes you classify before you type is a box you stop using
 * by October.
 *
 * So this box takes whatever you have: typed, pasted, dropped or
 * photographed. The server reads it, works out what each piece is — a task,
 * an event, or a thought about a class — and saves it. Nothing to choose, no
 * form, no dropdowns.
 *
 * Images: drag one onto the box, paste a screenshot, or use the paperclip.
 * They are downscaled in the browser, read by the model alongside the text,
 * and attached to whatever it files.
 *
 * It saves rather than proposing on purpose. A confirmation step is the right
 * call for an assistant acting on its own initiative, and the wrong call for
 * something you just typed yourself: you already decided. What replaces it is
 * Undo — the toast puts everything back for a few seconds.
 */

import { CornerDownLeft, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCapture } from "@/lib/hooks/use-capture";
import { isImageFile, prepareImage, type PreparedImage } from "@/lib/repo/blobs";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 4;

interface Pending extends PreparedImage {
  key: string;
  previewUrl: string;
}

export function CaptureBar({
  /** Pre-attach everything captured here to one class. Used on a class page. */
  courseId,
  placeholder = "Type anything — a task, a date, a thought — or drop in a photo",
  className,
}: {
  courseId?: string | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}) {
  const capture = useCapture();
  const [text, setText] = useState("");
  const [images, setImages] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Object URLs are revoked when the preview goes away, not before.
  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.previewUrl)), [images]);

  async function addFiles(files: Iterable<File>) {
    const list = [...files].filter(isImageFile);
    if (list.length === 0) {
      toast("Only images can be attached", { description: "PNG, JPEG, WebP or GIF." });
      return;
    }
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      toast(`Up to ${MAX_IMAGES} images at a time`);
      return;
    }
    const prepared: Pending[] = [];
    for (const file of list.slice(0, room)) {
      try {
        const image = await prepareImage(file, file.name);
        prepared.push({
          ...image,
          key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          previewUrl: URL.createObjectURL(image.blob),
        });
      } catch (error) {
        toast.error("Could not read that image", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }
    if (prepared.length > 0) setImages((prev) => [...prev, ...prepared]);
    inputRef.current?.focus();
  }

  function remove(key: string) {
    setImages((prev) => {
      const gone = prev.find((i) => i.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
  }

  async function submit() {
    const value = text.trim();
    if ((!value && images.length === 0) || busy) return;
    setBusy(true);
    try {
      const outcome = await capture({ text: value, images, courseId });
      if (outcome.ok) {
        setText("");
        setImages([]);
        inputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  }

  const canSubmit = !busy && (text.trim().length > 0 || images.length > 0);

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "relative rounded-[14px] border bg-card p-2 transition-colors focus-within:border-foreground/20",
        dragging ? "border-primary bg-primary-soft/30" : "border-border",
        className,
      )}
    >
      {dragging ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[14px] border-2 border-dashed border-primary/60 bg-background/70 text-[13px] font-medium text-primary"
        >
          Drop to attach
        </div>
      ) : null}

      <Textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        // Enter files it; Shift+Enter is a newline, so pasting a multi-line
        // email and then pressing Enter still works the way it reads.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter(isImageFile);
          if (files.length > 0) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        placeholder={placeholder}
        rows={2}
        disabled={busy}
        aria-label="Capture anything"
        className="min-h-[52px] resize-none border-0 bg-transparent px-2 py-1.5 text-[13.5px] shadow-none focus-visible:ring-0"
      />

      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-2 pb-1 pt-0.5" aria-label="Attached images">
          {images.map((image) => (
            <li key={image.key} className="group relative">
              <img
                src={image.previewUrl}
                alt={image.name}
                width={56}
                height={56}
                className="size-14 rounded-[8px] border border-border object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${image.name}`}
                onClick={() => remove(image.key)}
                disabled={busy}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-urgent"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-between gap-2 px-2 pb-0.5 pt-1">
        <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          <span className="truncate">Sorts itself into tasks, events and class notes</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            aria-label="Attach an image"
            title="Attach an image — or drop or paste one"
            disabled={busy || images.length >= MAX_IMAGES}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-[12px]"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Filing…
              </>
            ) : (
              <>
                Save <CornerDownLeft className="size-3.5" aria-hidden />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

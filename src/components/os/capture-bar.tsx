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
 * Images: drop one anywhere on the page, paste a screenshot, or use the
 * paperclip. They are downscaled in the browser to a size the server will
 * take, read by the model alongside the text, and attached to whatever it
 * files. The drop target is the whole window on purpose: a photo dropped an
 * inch outside a box would otherwise replace the app with the photo.
 *
 * It saves rather than proposing on purpose. A confirmation step is the right
 * call for an assistant acting on its own initiative, and the wrong call for
 * something you just typed yourself: you already decided. What replaces it is
 * Undo — the toast puts everything back for a few seconds.
 */

import { CornerDownLeft, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCapture } from "@/lib/hooks/use-capture";
import { MAX_IMAGES, isImageFile, prepareImage, type PreparedImage } from "@/lib/repo/blobs";
import { cn } from "@/lib/utils";

/** Mounted boxes, oldest first. See the window listeners below. */
const dropTargets: object[] = [];

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
  // The window listeners below are registered once; they reach the latest
  // `addFiles` through this ref.
  const addFilesRef = useRef<(files: Iterable<File>) => Promise<void>>(async () => {});

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

  addFilesRef.current = addFiles;

  // The whole page accepts a drop. Only the most recently mounted box takes
  // it, so a class page's box wins over the home box underneath.
  useEffect(() => {
    const token = {};
    dropTargets.push(token);
    const mine = () => dropTargets[dropTargets.length - 1] === token;
    const hasFiles = (e: globalThis.DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    let depth = 0;

    const onEnter = (e: globalThis.DragEvent) => {
      if (!mine() || !hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: globalThis.DragEvent) => {
      if (!mine() || !hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: globalThis.DragEvent) => {
      if (!mine() || !hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: globalThis.DragEvent) => {
      if (!mine() || !hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) void addFilesRef.current(files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      const at = dropTargets.indexOf(token);
      if (at >= 0) dropTargets.splice(at, 1);
    };
  }, []);

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

  const canSubmit = !busy && (text.trim().length > 0 || images.length > 0);

  return (
    <div
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
            title="Attach an image — or drop one anywhere, or paste"
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

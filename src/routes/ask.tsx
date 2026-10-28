import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Download,
  FileText,
  ImagePlus,
  KeyRound,
  Loader2,
  MessageSquare,
  Paperclip,
  PanelLeft,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CompassAnswer } from "@/components/os/compass-answer";
import { ProposalCard, ToolResultBlock } from "@/components/os/compass-blocks";
import { EmptyState, Panel, Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_LOCAL_PDF_BYTES,
  MAX_PDF_BYTES,
  chatFileUrl,
  formatBytes,
  isPdfFile,
  type FileStore,
} from "@/lib/chat/files";
import type { ChatFile, ChatSummary } from "@/lib/chat/types";
import { useProviderConfig } from "@/lib/integrations/use-integrations";
import {
  TOOL_LABEL,
  useCompassChat,
  type OutgoingFile,
  type Turn,
  type TurnImage,
} from "@/lib/compass/use-compass-chat";
import { isImageFile, prepareImage } from "@/lib/repo/blobs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask · AaditOS" },
      {
        name: "description",
        content: "Ask anything: your day, your classes, a PDF, a photo, or a picture to draw.",
      },
    ],
  }),
  component: AskPage,
});

const SUGGESTIONS = [
  "What should I do right now?",
  "What is due this week?",
  "Explain this like I'm new to it",
  "Draw a poster for the robotics club",
  "Quiz me on what I attached",
];

interface Pending extends OutgoingFile {
  key: string;
  previewUrl?: string | undefined;
}

function AskPage() {
  const config = useProviderConfig();
  const chat = useCompassChat();
  const { turns, busy, uploading, send, stop, retry, fileStore } = chat;
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFilesRef = useRef<(files: Iterable<File>) => Promise<void>>(async () => {});

  const configured = config.data?.openai ?? false;
  const local = fileStore.kind === "local";

  useEffect(
    () => () => pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)),
    [pending],
  );

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      const list = [...files];
      const accepted: Pending[] = [];
      for (const file of list) {
        try {
          if (isImageFile(file)) {
            const image = await prepareImage(file, file.name);
            accepted.push({
              key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              kind: "image",
              blob: image.blob,
              name: image.name,
              mimeType: image.mimeType,
              width: image.width,
              height: image.height,
              previewUrl: URL.createObjectURL(image.blob),
            });
          } else if (isPdfFile(file)) {
            const limit = local ? MAX_LOCAL_PDF_BYTES : MAX_PDF_BYTES;
            if (file.size > limit) {
              toast.error(`"${file.name}" is too big`, {
                description: `PDFs up to ${formatBytes(limit)} here.`,
              });
              continue;
            }
            accepted.push({
              key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              kind: "pdf",
              blob: file,
              name: file.name,
              mimeType: "application/pdf",
            });
          } else {
            toast(`"${file.name}" is not something it can read`, {
              description: "Images and PDFs only.",
            });
          }
        } catch (error) {
          toast.error(`Could not read "${file.name}"`, {
            description: error instanceof Error ? error.message : undefined,
          });
        }
      }
      if (accepted.length > 0) setPending((prev) => [...prev, ...accepted]);
      inputRef.current?.focus();
    },
    [local],
  );
  addFilesRef.current = addFiles;

  // The whole page accepts a drop, so a photo dropped an inch outside the
  // box attaches instead of replacing the app with the photo.
  useEffect(() => {
    const hasFiles = (e: globalThis.DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    let depth = 0;
    const onEnter = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
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
    };
  }, []);

  const removePending = (key: string) =>
    setPending((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.key !== key);
    });

  const submit = () => {
    const text = input.trim();
    if ((!text && pending.length === 0) || busy || uploading) return;
    const files = pending;
    setInput("");
    setPending([]);
    void send(text, files);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const canSend =
    configured && !busy && !uploading && (input.trim().length > 0 || pending.length > 0);

  const list = (
    <ChatList
      chats={chat.chats}
      ready={chat.chatsReady}
      activeId={chat.activeId}
      onNew={() => {
        chat.newChat();
        setSidebarOpen(false);
        inputRef.current?.focus();
      }}
      onOpen={(id) => {
        void chat.openChat(id);
        setSidebarOpen(false);
      }}
      onDelete={(id) => void chat.deleteChat(id)}
    />
  );

  return (
    // dvh: this is the one page that is a composer, so it is the one page a
    // Chromebook's on-screen keyboard is guaranteed to shrink. Measured, not
    // guessed: top bar 53 + main's 20/20 padding = 93, plus the 52px bottom nav
    // below the sm breakpoint.
    <div className="flex h-[calc(100dvh-145px)] gap-5 sm:h-[calc(100dvh-93px)]">
      <aside className="hidden w-56 shrink-0 flex-col lg:flex">{list}</aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3 pb-3">
          <div className="flex min-w-0 items-start gap-2">
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 size-8 shrink-0 lg:hidden"
                  aria-label="Open chats"
                >
                  <PanelLeft className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-4">
                <SheetTitle className="sr-only">Chats</SheetTitle>
                {list}
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-tight">Ask</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Anything. It reads your tasks, classes, calendar and notes, your photos and PDFs,
                and it can draw.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {config.isLoading ? null : configured ? (
              <Pill
                tone="success"
                title={`Models: ${(config.data?.openaiModels ?? []).join(" → ")}`}
              >
                {config.data?.openaiModel}
              </Pill>
            ) : (
              <Pill tone="warning">Not configured</Pill>
            )}
            <Button
              variant="outline"
              size="sm"
              className="hidden h-7 gap-1.5 text-[12px] lg:inline-flex"
              onClick={() => {
                chat.newChat();
                inputRef.current?.focus();
              }}
              disabled={turns.length === 0}
            >
              <Plus className="size-3.5" aria-hidden /> New chat
            </Button>
          </div>
        </div>

        {!config.isLoading && !configured ? (
          <Panel className="mb-4">
            <div className="px-4 py-4">
              <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  This needs an OpenAI key. Set{" "}
                  <code className="rounded bg-secondary px-1">OPENAI_API_KEY</code> on the server to
                  turn it on. Everything else works without it, and nothing is faked in the
                  meantime.
                </span>
              </p>
            </div>
          </Panel>
        ) : null}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
          {turns.length === 0 ? (
            <Panel>
              <EmptyState
                icon={Sparkles}
                title="Ask anything"
                description="A question about your day, help with homework, a PDF to read, a photo to look at, or a picture to make. It checks your own workspace first and shows what it used."
              />
              <div className="border-t border-border p-3">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Try
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={!configured || busy}
                      onClick={() => void send(suggestion)}
                      className="rounded-[9px] border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:border-foreground/20 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          ) : (
            turns.map((turn) =>
              turn.role === "user" ? (
                <UserTurn key={turn.id} turn={turn} store={fileStore} />
              ) : (
                <AssistantTurn
                  key={turn.id}
                  turn={turn}
                  store={fileStore}
                  onRetry={() => void retry()}
                />
              ),
            )
          )}
        </div>

        <form
          className={cn(
            "relative rounded-[14px] border bg-card p-2 transition-colors focus-within:border-foreground/20",
            dragging ? "border-primary bg-primary-soft/30" : "border-border",
          )}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {dragging ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[14px] border-2 border-dashed border-primary/60 bg-background/70 text-[13px] font-medium text-primary"
            >
              Drop images or PDFs to attach
            </div>
          ) : null}

          {pending.length > 0 ? (
            <ul className="flex flex-wrap gap-2 px-2 pb-1.5 pt-1" aria-label="Files to send">
              {pending.map((file) => (
                <li key={file.key} className="group relative">
                  {file.kind === "image" && file.previewUrl ? (
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      width={56}
                      height={56}
                      className="size-14 rounded-[8px] border border-border object-cover"
                    />
                  ) : (
                    <span className="flex h-14 max-w-48 items-center gap-2 rounded-[8px] border border-border bg-secondary/60 px-2.5 text-[12px]">
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{file.name}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          PDF · {formatBytes(file.blob.size)}
                        </span>
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removePending(file.key)}
                    disabled={busy || uploading}
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-urgent"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-end gap-2">
            <label htmlFor="ask-input" className="sr-only">
              Ask a question
            </label>
            <Textarea
              ref={inputRef}
              id="ask-input"
              rows={1}
              value={input}
              disabled={!configured}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter(
                  (f) => isImageFile(f) || isPdfFile(f),
                );
                if (files.length > 0) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              placeholder={
                configured
                  ? pending.length > 0
                    ? "Say what to do with the files, or just send them"
                    : "Ask anything, or drop in photos and PDFs…"
                  : "Not configured"
              }
              className="max-h-40 min-h-[38px] resize-none border-0 bg-transparent px-2 py-2 text-[13.5px] shadow-none focus-visible:ring-0"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf,.pdf,.heic,.heif"
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
              className="size-9 shrink-0 text-muted-foreground"
              aria-label="Attach images or PDFs"
              title="Attach images or PDFs — as many as you like. Or drop them anywhere, or paste."
              disabled={!configured || busy || uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="size-4" aria-hidden />
            </Button>
            {busy || uploading ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-9 shrink-0"
                aria-label={uploading ? "Uploading files" : "Stop generating"}
                onClick={stop}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Square className="size-3.5" />
                )}
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="size-9 shrink-0"
                disabled={!canSend}
                aria-label="Send"
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <ImagePlus className="size-3 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              {local
                ? "Files stay on this device, and one message can carry about 4 MB."
                : "Files go to your own private storage; the model gets a link. Nothing is kept by OpenAI."}
            </span>
          </p>
        </form>
      </section>
    </div>
  );
}

// ---- chat list ------------------------------------------------------------

function ChatList({
  chats,
  ready,
  activeId,
  onNew,
  onOpen,
  onDelete,
}: {
  chats: ChatSummary[];
  ready: boolean;
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Button
        variant="outline"
        size="sm"
        className="mb-3 h-8 w-full justify-start gap-2 text-[12.5px]"
        onClick={onNew}
      >
        <Plus className="size-3.5" aria-hidden /> New chat
      </Button>
      <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">Chats</p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Chats">
        {!ready ? (
          <li className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading…</li>
        ) : chats.length === 0 ? (
          <li className="px-2 py-1.5 text-[12px] text-muted-foreground">
            Nothing yet. Every conversation is kept here.
          </li>
        ) : (
          chats.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                aria-current={c.id === activeId ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 pr-8 text-left text-[12.5px] transition-colors",
                  c.id === activeId
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <MessageSquare className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="truncate">{c.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete chat "${c.title}"`}
                onClick={() => onDelete(c.id)}
                className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-opacity hover:text-urgent focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ---- turns ---------------------------------------------------------------

function useChatFileSrc(store: FileStore, file: ChatFile | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!file) return;
    chatFileUrl(store, file)
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [store, file]);
  return src;
}

function UserFile({ store, file }: { store: FileStore; file: ChatFile }) {
  const src = useChatFileSrc(store, file);
  if (file.kind === "pdf") return <PdfChip store={store} file={file} />;
  return (
    <ImageWithLightbox
      src={src}
      name={file.name}
      className="size-20 rounded-[8px] border border-border object-cover"
    />
  );
}

function PdfChip({ store, file }: { store: FileStore; file: ChatFile }) {
  return (
    <button
      type="button"
      onClick={() => {
        chatFileUrl(store, file)
          .then((url) => window.open(url, "_blank", "noopener"))
          .catch(() => toast.error("That PDF is no longer available"));
      }}
      className="flex h-12 max-w-56 items-center gap-2 rounded-[8px] border border-border bg-card px-2.5 text-left text-[12px] transition-colors hover:border-foreground/20"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium">{file.name}</span>
        <span className="block text-[11px] text-muted-foreground">
          PDF · {formatBytes(file.size)}
        </span>
      </span>
    </button>
  );
}

function UserTurn({ turn, store }: { turn: Turn; store: FileStore }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {turn.files.length > 0 ? (
        <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5" aria-label="Attached files">
          {turn.files.map((file) => (
            <li key={file.id}>
              <UserFile store={store} file={file} />
            </li>
          ))}
        </ul>
      ) : null}
      {turn.text ? (
        <p className="max-w-[85%] whitespace-pre-wrap rounded-[12px] bg-secondary px-3 py-2 text-[13px]">
          {turn.text}
        </p>
      ) : null}
    </div>
  );
}

function AssistantImage({ store, image }: { store: FileStore; image: TurnImage }) {
  const stored = useChatFileSrc(store, image.src ? undefined : image.file);
  const src = image.src ?? stored;
  const name = image.file?.name ?? `picture.${image.src?.includes("image/png") ? "png" : "webp"}`;
  return (
    <div className="relative">
      <ImageWithLightbox
        src={src}
        name={name}
        className={cn(
          "max-h-[420px] w-auto max-w-full rounded-[12px] border border-border object-contain transition-[filter] duration-300",
          image.partial && "blur-[2px]",
        )}
      />
      {image.partial ? (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2 py-0.5 text-[11px] text-muted-foreground backdrop-blur">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Drawing…
        </span>
      ) : src ? (
        <a
          href={src}
          download={name}
          className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-background/85 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
          aria-label="Download picture"
          title="Download"
        >
          <Download className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

function ImageWithLightbox({
  src,
  name,
  className,
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!src) {
    return (
      <div className={cn("grid place-items-center bg-secondary", className)}>
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open ${name}`}>
        <img src={src} alt={name} className={className} loading="lazy" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-3 sm:p-4">
          <DialogTitle className="pr-8 text-[13px] font-medium">{name}</DialogTitle>
          <div className="grid place-items-center">
            <img
              src={src}
              alt={name}
              className="max-h-[80dvh] w-auto max-w-full rounded-[10px] object-contain"
            />
          </div>
          <div className="flex justify-end">
            <a
              href={src}
              download={name}
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

function AssistantTurn({
  turn,
  store,
  onRetry,
}: {
  turn: Turn;
  store: FileStore;
  onRetry: () => void;
}) {
  return (
    <article className="space-y-2.5">
      {turn.tools.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {turn.tools.map((tool, i) => (
            <li key={`${tool.name}-${i}`}>
              <Pill tone={tool.done ? "neutral" : "primary"}>
                {tool.done ? null : <Loader2 className="size-3 animate-spin" aria-hidden />}
                {TOOL_LABEL[tool.name] ?? tool.name}
              </Pill>
            </li>
          ))}
        </ul>
      ) : null}

      {turn.tools
        .filter((tool) => tool.done && tool.data && tool.name !== "generate_image")
        .map((tool, i) => (
          <ToolResultBlock key={`${tool.name}-block-${i}`} name={tool.name} data={tool.data} />
        ))}

      {turn.images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {turn.images.map((image) => (
            <AssistantImage key={image.id} store={store} image={image} />
          ))}
        </div>
      ) : null}

      {turn.text ? (
        <CompassAnswer text={turn.text} className="text-[13px]" />
      ) : turn.streaming && turn.tools.length === 0 && turn.images.length === 0 ? (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Thinking…
        </p>
      ) : null}

      {turn.proposals.map((proposal, i) => (
        <ProposalCard key={`${turn.id}-proposal-${i}`} proposal={proposal} />
      ))}

      {turn.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[12px] border border-urgent/30 bg-urgent-soft px-3 py-2.5 text-[12.5px] text-urgent"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            {turn.error.message}
            {turn.error.retryable ? (
              <button type="button" className="ml-2 underline underline-offset-2" onClick={onRetry}>
                Retry
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      {!turn.streaming && turn.model && !turn.error ? (
        <p className="text-[11px] text-muted-foreground/80">{turn.model}</p>
      ) : null}
    </article>
  );
}

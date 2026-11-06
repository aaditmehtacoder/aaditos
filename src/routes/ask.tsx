import { createFileRoute } from "@tanstack/react-router";
import { differenceInCalendarDays } from "date-fns";
import {
  AlertTriangle,
  ArrowDown,
  ChevronsRight,
  ArrowUp,
  Check,
  Download,
  FileText,
  KeyRound,
  Loader2,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  SquarePen,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ProposalCard, ToolResultBlock } from "@/components/os/compass-blocks";
import { ImageWithLightbox } from "@/components/os/image-lightbox";
import { CopyButton, Markdown } from "@/components/os/markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  MAX_LOCAL_PDF_BYTES,
  MAX_PDF_BYTES,
  chatFileUrl,
  formatBytes,
  isPdfFile,
  type FileStore,
} from "@/lib/chat/files";
import type { ChatFile, ChatSummary } from "@/lib/chat/types";
import { MAX_MESSAGE_CHARS } from "@/lib/compass/types";
import { useProviderConfig } from "@/lib/integrations/use-integrations";
import {
  TOOL_DONE_LABEL,
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
      { title: "Ask" },
      {
        name: "description",
        content: "Ask anything: homework, writing, code, maths, the news, a PDF or a photo.",
      },
    ],
  }),
  component: AskPage,
});

const SUGGESTIONS = [
  "What should I work on right now?",
  "Explain how to add 3/4 + 5/6",
  "Compare mitosis and meiosis in a table",
  "Show me pictures of a Komodo dragon",
  "What's in the news today?",
];

interface Pending extends OutgoingFile {
  key: string;
  previewUrl?: string | undefined;
}

function AskPage() {
  const config = useProviderConfig();
  const chat = useCompassChat();
  const { turns, busy, uploading, send, stop, retry, edit, fileStore } = chat;
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFilesRef = useRef<(files: Iterable<File>) => Promise<void>>(async () => {});

  const configured = config.data?.openai ?? false;
  const local = fileStore.kind === "local";
  const empty = turns.length === 0;

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

  const followAgain = () => {
    atBottomRef.current = true;
    setAtBottom(true);
  };

  const submit = (text = input) => {
    const clean = text.trim();
    if ((!clean && pending.length === 0) || busy || uploading || !configured) return;
    if (clean.length > MAX_MESSAGE_CHARS) {
      toast.error("That message is too long", {
        description: `Up to ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters. For more, attach it as a PDF.`,
      });
      return;
    }
    const files = pending;
    setInput("");
    setPending([]);
    followAgain();
    void send(clean, files);
  };

  // Follow the answer as it streams, unless the reader has scrolled up to
  // read something earlier; then leave them there and offer a way back.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    atBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    followAgain();
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

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
        followAgain();
        void chat.openChat(id);
        setSidebarOpen(false);
      }}
      onDelete={(id) => void chat.deleteChat(id)}
    />
  );

  const composer = (
    <Composer
      inputRef={inputRef}
      fileRef={fileRef}
      input={input}
      setInput={setInput}
      pending={pending}
      removePending={removePending}
      addFiles={addFiles}
      onSubmit={() => submit()}
      onStop={stop}
      busy={busy}
      uploading={uploading}
      configured={configured}
      local={local}
    />
  );

  return (
    // dvh: this is the one page that is a composer, so it is the one page a
    // Chromebook's on-screen keyboard is guaranteed to shrink. Measured, not
    // guessed: top bar 53 + main's 20/20 padding = 93, plus the 52px bottom nav
    // below the sm breakpoint.
    <div className="flex h-[calc(100dvh-145px)] gap-4 sm:h-[calc(100dvh-93px)]">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border pr-3 lg:flex">
        {list}
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        {dragging ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[18px] border-2 border-dashed border-primary/50 bg-background/85 backdrop-blur-sm"
          >
            <div className="text-center">
              <p className="text-[15px] font-medium">Drop files here</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">Images and PDFs</p>
            </div>
          </div>
        ) : null}

        <div className="flex h-9 shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 lg:hidden"
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
            {config.isLoading ? null : configured ? (
              <span
                className="truncate px-1 text-[13px] font-medium text-muted-foreground"
                title={`Falls back through: ${(config.data?.openaiModels ?? []).join(" → ")}`}
              >
                {config.data?.openaiModel}
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="New chat"
            title="New chat"
            disabled={empty}
            onClick={() => {
              chat.newChat();
              inputRef.current?.focus();
            }}
          >
            <SquarePen className="size-4" aria-hidden />
          </Button>
        </div>

        {!config.isLoading && !configured ? (
          <div className="mx-auto mt-2 w-full max-w-3xl rounded-[14px] border border-border bg-card px-4 py-3">
            <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                This needs an OpenAI key. Set{" "}
                <code className="rounded bg-secondary px-1">OPENAI_API_KEY</code> on the server to
                turn it on. Nothing is faked in the meantime.
              </span>
            </p>
          </div>
        ) : null}

        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-[8vh]">
            <h1 className="mb-7 text-center text-[26px] font-semibold tracking-tight sm:text-[28px]">
              What can I help with?
            </h1>
            <div className="w-full max-w-3xl">{composer}</div>
            <div className="mt-4 flex max-w-3xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={!configured || busy}
                  onClick={() => submit(suggestion)}
                  className="rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-3xl space-y-8 px-1 pb-8 pt-4">
                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <UserTurn
                      key={turn.id}
                      turn={turn}
                      store={fileStore}
                      busy={busy}
                      onEdit={(text) => {
                        followAgain();
                        void edit(turn.id, text);
                      }}
                    />
                  ) : (
                    <AssistantTurn
                      key={turn.id}
                      turn={turn}
                      store={fileStore}
                      last={turn.id === lastAssistant?.id}
                      busy={busy}
                      onRetry={() => {
                        followAgain();
                        void retry();
                      }}
                      onContinue={() => submit("Continue exactly where you stopped.")}
                    />
                  ),
                )}
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-3xl shrink-0">
              {!atBottom ? (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  aria-label="Scroll to the latest message"
                  className="absolute -top-12 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
              ) : null}
              {composer}
              <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
                Answers can be wrong. Check anything important.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---- composer --------------------------------------------------------------

function Composer({
  inputRef,
  fileRef,
  input,
  setInput,
  pending,
  removePending,
  addFiles,
  onSubmit,
  onStop,
  busy,
  uploading,
  configured,
  local,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileRef: React.RefObject<HTMLInputElement | null>;
  input: string;
  setInput: (value: string) => void;
  pending: Pending[];
  removePending: (key: string) => void;
  addFiles: (files: Iterable<File>) => Promise<void>;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  uploading: boolean;
  configured: boolean;
  local: boolean;
}) {
  const length = input.length;
  const over = length > MAX_MESSAGE_CHARS;
  const canSend =
    configured && !busy && !uploading && !over && (input.trim().length > 0 || pending.length > 0);

  // Grows with what is typed, up to a third of the screen, then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input, inputRef]);

  return (
    <form
      className="rounded-[26px] border border-border bg-card px-2.5 pb-2 pt-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_-6px_rgba(0,0,0,0.08)] transition-colors focus-within:border-foreground/20"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {pending.length > 0 ? (
        <ul className="flex flex-wrap gap-2 px-1.5 pb-2 pt-1" aria-label="Files to send">
          {pending.map((file) => (
            <li key={file.key} className="group relative">
              {file.kind === "image" && file.previewUrl ? (
                <img
                  src={file.previewUrl}
                  alt={file.name}
                  width={56}
                  height={56}
                  className="size-14 rounded-[12px] border border-border object-cover"
                />
              ) : (
                <span className="flex h-14 max-w-52 items-center gap-2.5 rounded-[12px] border border-border bg-secondary/60 px-3 text-[12px]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-urgent text-white">
                    <FileText className="size-4" aria-hidden />
                  </span>
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
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-sm transition-opacity hover:opacity-80"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label htmlFor="ask-input" className="sr-only">
        Message
      </label>
      <textarea
        ref={inputRef}
        id="ask-input"
        rows={1}
        value={input}
        disabled={!configured}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter((f) => isImageFile(f) || isPdfFile(f));
          if (files.length > 0) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        placeholder={configured ? "Ask anything" : "Not configured"}
        className="block max-h-[220px] min-h-[40px] w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />

      <div className="flex items-center gap-2 pt-1">
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
        <button
          type="button"
          className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          aria-label="Add photos and PDFs"
          title={
            local
              ? "Add photos and PDFs. They stay on this device; one message can carry about 4 MB."
              : "Add photos and PDFs, as many as you like. Or drop or paste them."
          }
          disabled={!configured || busy || uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Plus className="size-5" aria-hidden />
        </button>
        <span className="ml-auto" />
        {length > MAX_MESSAGE_CHARS * 0.8 ? (
          <span
            className={cn(
              "text-[11.5px] tabular-nums",
              over ? "font-medium text-urgent" : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {length.toLocaleString("en-US")} / {MAX_MESSAGE_CHARS.toLocaleString("en-US")}
          </span>
        ) : null}
        {busy || uploading ? (
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-60"
            aria-label={uploading ? "Uploading files" : "Stop generating"}
            onClick={onStop}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Square className="size-3.5 fill-current" aria-hidden />
            )}
          </button>
        ) : (
          <button
            type="submit"
            className="grid size-9 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-25"
            disabled={!canSend}
            aria-label="Send"
          >
            <ArrowUp className="size-[18px]" strokeWidth={2.4} aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}

// ---- chat list ------------------------------------------------------------

const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"] as const;

function groupOf(updatedAt: string, now: Date): (typeof GROUPS)[number] {
  const days = differenceInCalendarDays(now, new Date(updatedAt));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}

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
  const now = new Date();
  const groups = GROUPS.map((label) => ({
    label,
    chats: chats.filter((c) => groupOf(c.updatedAt, now) === label),
  })).filter((g) => g.chats.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        onClick={onNew}
        className="mb-3 flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] font-medium transition-colors hover:bg-secondary"
      >
        <SquarePen className="size-4" aria-hidden /> New chat
      </button>
      <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Chats">
        {!ready ? (
          <p className="px-2.5 py-1.5 text-[12.5px] text-muted-foreground">Loading…</p>
        ) : chats.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[12.5px] text-muted-foreground">
            No chats yet. Every conversation is kept here.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-px">
                {group.chats.map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      aria-current={c.id === activeId ? "true" : undefined}
                      className={cn(
                        "flex h-9 w-full items-center rounded-[10px] px-2.5 pr-9 text-left text-[13.5px] transition-colors",
                        c.id === activeId
                          ? "bg-secondary text-foreground"
                          : "text-foreground/85 hover:bg-secondary/70",
                      )}
                    >
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete chat "${c.title}"`}
                      onClick={() => onDelete(c.id)}
                      className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[8px] text-muted-foreground opacity-0 transition-opacity hover:text-urgent focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
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
      className="size-24 rounded-[14px] border border-border object-cover"
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
      className="flex h-14 max-w-60 items-center gap-2.5 rounded-[14px] border border-border bg-card px-3 text-left text-[12.5px] transition-colors hover:border-foreground/20"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-urgent text-white">
        <FileText className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{file.name}</span>
        <span className="block text-[11px] text-muted-foreground">
          PDF · {formatBytes(file.size)}
        </span>
      </span>
    </button>
  );
}

function UserTurn({
  turn,
  store,
  busy,
  onEdit,
}: {
  turn: Turn;
  store: FileStore;
  busy: boolean;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [draft, editing]);

  return (
    <div className="group flex flex-col items-end gap-1.5">
      {turn.files.length > 0 ? (
        <ul className="flex max-w-[85%] flex-wrap justify-end gap-2" aria-label="Attached files">
          {turn.files.map((file) => (
            <li key={file.id}>
              <UserFile store={store} file={file} />
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <form
          className="w-full rounded-[22px] bg-secondary p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            if (draft.trim() !== turn.text.trim()) onEdit(draft);
          }}
        >
          <label htmlFor={`edit-${turn.id}`} className="sr-only">
            Edit message
          </label>
          <textarea
            id={`edit-${turn.id}`}
            ref={ref}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            className="block w-full resize-none bg-transparent px-1 text-[15px] leading-7 outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3.5 text-[13px]"
              onClick={() => {
                setDraft(turn.text);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-full bg-foreground px-3.5 text-[13px] text-background hover:bg-foreground/85"
              disabled={
                busy ||
                draft.length > MAX_MESSAGE_CHARS ||
                (!draft.trim() && turn.files.length === 0)
              }
            >
              Send
            </Button>
          </div>
        </form>
      ) : turn.text ? (
        <>
          <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-[22px] bg-secondary px-4 py-2.5 text-[15px] leading-7">
            {turn.text}
          </p>
          <div className="flex items-center gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
            <CopyButton
              text={turn.text}
              label="Copy message"
              showLabel={false}
              className="grid size-8 place-items-center hover:bg-secondary"
            />
            <button
              type="button"
              aria-label="Edit message"
              title="Edit message"
              disabled={busy}
              onClick={() => {
                setDraft(turn.text);
                setEditing(true);
              }}
              className="grid size-8 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
          </div>
        </>
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
          "max-h-[460px] w-auto max-w-full rounded-[16px] border border-border object-contain transition-[filter] duration-300",
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
          className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-full bg-background/85 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
          aria-label="Download picture"
          title="Download"
        >
          <Download className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

function AssistantTurn({
  turn,
  store,
  last,
  busy,
  onRetry,
  onContinue,
}: {
  turn: Turn;
  store: FileStore;
  last: boolean;
  busy: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const waiting =
    turn.streaming && !turn.text && turn.images.length === 0 && !turn.tools.some((t) => !t.done);

  return (
    <article className="space-y-3" aria-busy={turn.streaming || undefined}>
      {turn.tools.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {turn.tools.map((tool, i) => (
            <li
              key={`${tool.name}-${i}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px]",
                tool.done ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {tool.done ? (
                <Check className="size-3" aria-hidden />
              ) : (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              )}
              {(tool.done ? TOOL_DONE_LABEL[tool.name] : undefined) ??
                TOOL_LABEL[tool.name] ??
                tool.name}
            </li>
          ))}
        </ul>
      ) : null}

      {turn.tools
        .filter((tool) => tool.done && tool.data && !NO_BLOCK.has(tool.name))
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

      {turn.text ? <Markdown text={turn.text} /> : null}

      {waiting ? (
        <span className="flex h-7 items-center" role="status" aria-label="Thinking">
          <span className="think-dot inline-block size-3.5 rounded-full bg-foreground" />
        </span>
      ) : null}

      {turn.proposals.map((proposal, i) => (
        <ProposalCard key={`${turn.id}-proposal-${i}`} proposal={proposal} />
      ))}

      {turn.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[14px] border border-urgent/30 bg-urgent-soft px-3.5 py-2.5 text-[13px] text-urgent"
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

      {last && turn.truncated && !turn.streaming ? (
        <button
          type="button"
          onClick={onContinue}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[13px] transition-colors hover:bg-secondary disabled:opacity-50"
        >
          <ChevronsRight className="size-3.5" aria-hidden /> Continue
        </button>
      ) : null}

      {!turn.streaming && (turn.text || turn.error) ? (
        <div className="-ml-1.5 flex items-center gap-0.5">
          {turn.text ? (
            <CopyButton
              text={turn.text}
              label="Copy answer"
              showLabel={false}
              className="grid size-8 place-items-center hover:bg-secondary"
            />
          ) : null}
          {last ? (
            <button
              type="button"
              aria-label="Regenerate answer"
              title="Regenerate"
              disabled={busy}
              onClick={onRetry}
              className="grid size-8 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </button>
          ) : null}
          {turn.model && !turn.error ? (
            <span className="ml-1.5 text-[11.5px] text-muted-foreground/80">{turn.model}</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Steps whose result is already in the answer itself. */
const NO_BLOCK = new Set(["generate_image", "web_search", "find_images"]);

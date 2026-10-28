/**
 * The conversation: turns on screen, files in storage, chats in a list.
 *
 * One hook drives the whole Ask page so that streaming, tools, pictures,
 * cancellation, errors and persistence can never drift apart. A turn is:
 *
 *   1. put the user's files away (Storage, or IndexedDB in demo mode)
 *   2. send the window of history as *links*, never bytes
 *   3. stream events into the assistant turn as they arrive
 *   4. keep any picture it drew, then save the chat
 *
 * The model sees the previous answer's pictures again on the next turn, so
 * "make it blue" edits the thing it just made instead of starting over.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  base64ToBlob,
  chatFileWireUrl,
  deleteChatFile,
  fileStoreFor,
  storeChatFile,
  type FileStore,
} from "@/lib/chat/files";
import { chatStoreFor, type ChatStore } from "@/lib/chat/store";
import {
  titleFor,
  type Chat,
  type ChatFile,
  type ChatMessage,
  type ChatSummary,
} from "@/lib/chat/types";
import { newId } from "@/lib/core/ids";
import { nowISO } from "@/lib/core/time";
import { streamCompass } from "@/lib/compass/client";
import { buildSnapshot } from "@/lib/compass/snapshot";
import type {
  CompassEvent,
  CompassMessage,
  CompassProposal,
  CompassToolName,
  WireAttachment,
} from "@/lib/compass/types";
import { useInbox } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";

/** Human label for each tool, shown while Compass is working. */
export const TOOL_LABEL: Record<CompassToolName, string> = {
  list_tasks: "Reading your tasks",
  get_task: "Opening a task",
  list_assignments: "Reading assignments",
  list_events: "Reading your calendar",
  list_notes: "Reading your notes",
  list_inbox: "Reading your inbox",
  create_daily_plan: "Building a plan",
  find_schedule_conflicts: "Checking for conflicts",
  propose_task: "Drafting a task",
  update_task: "Drafting a change",
  generate_image: "Drawing",
};

/** A picture in an assistant turn: fresh from the model, or kept from before. */
export interface TurnImage {
  id: string;
  /** A data URL while it is being drawn or just arrived; absent once only the stored file remains. */
  src?: string | undefined;
  partial: boolean;
  file?: ChatFile | undefined;
}

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  files: ChatFile[];
  images: TurnImage[];
  tools: Array<{ name: CompassToolName; data?: unknown; done: boolean }>;
  proposals: CompassProposal[];
  error?: { message: string; code: string; retryable: boolean } | undefined;
  streaming: boolean;
  model?: string | undefined;
}

/** A file the user picked, already prepared, waiting to be sent. */
export interface OutgoingFile {
  blob: Blob;
  kind: "image" | "pdf";
  name: string;
  mimeType: string;
  width?: number | undefined;
  height?: number | undefined;
}

export interface CompassChat {
  turns: Turn[];
  busy: boolean;
  /** "Putting files away" before the model is even asked. */
  uploading: boolean;
  send: (text: string, files?: OutgoingFile[]) => Promise<void>;
  stop: () => void;
  /** Sends the last user message again, replacing the failed answer. */
  retry: () => Promise<void>;
  chats: ChatSummary[];
  activeId: string | null;
  chatsReady: boolean;
  newChat: () => void;
  openChat: (id: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  fileStore: FileStore;
}

function turnsFromMessages(messages: ChatMessage[]): Turn[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    files: m.files ?? [],
    images: (m.images ?? []).map((file) => ({ id: file.id, partial: false, file })),
    tools: [],
    proposals: [],
    streaming: false,
    model: m.model,
  }));
}

function messagesFromTurns(turns: Turn[]): ChatMessage[] {
  return turns
    .filter((t) => t.text.trim() || t.files.length > 0 || t.images.some((i) => i.file))
    .map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      files: t.files,
      images: t.images.flatMap((i) => (i.file ? [i.file] : [])),
      createdAt: nowISO(),
      model: t.model,
    }));
}

export function useCompassChat(): CompassChat {
  const { workspace, isDemo, now, userId } = useOS();
  const { items: inbox } = useInbox();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatsReady, setChatsReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const activeRef = useRef<{ id: string; createdAt: string } | null>(null);

  const fileStore = useMemo(() => fileStoreFor(userId, isDemo), [userId, isDemo]);
  const chatStore = useMemo<ChatStore>(() => chatStoreFor(userId, isDemo), [userId, isDemo]);

  const snapshot = useMemo(
    () => buildSnapshot(workspace, now, { isDemo, inbox }),
    [workspace, now, isDemo, inbox],
  );

  // Abort any in-flight turn if the surface unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const refreshList = useCallback(async () => {
    try {
      setChats(await chatStore.list());
    } catch (error) {
      console.warn("[chat] could not list chats", error);
    } finally {
      setChatsReady(true);
    }
  }, [chatStore]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const persist = useCallback(
    async (current: Turn[]) => {
      const messages = messagesFromTurns(current);
      if (messages.length === 0) return;
      const firstUser = messages.find((m) => m.role === "user");
      const active = activeRef.current ?? { id: newId(), createdAt: nowISO() };
      activeRef.current = active;
      setActiveId(active.id);
      const chat: Chat = {
        id: active.id,
        title: titleFor(
          firstUser?.text ?? "",
          firstUser?.files.length ? `About ${firstUser.files[0]?.name ?? "a file"}` : "New chat",
        ),
        messages,
        createdAt: active.createdAt,
        updatedAt: nowISO(),
      };
      try {
        await chatStore.save(chat);
        setChats((prev) => [
          { id: chat.id, title: chat.title, updatedAt: chat.updatedAt },
          ...prev.filter((c) => c.id !== chat.id),
        ]);
      } catch (error) {
        console.warn("[chat] could not save the chat", error);
      }
    },
    [chatStore],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns((prev) => prev.map((t) => (t.streaming ? { ...t, streaming: false } : t)));
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns([]);
    activeRef.current = null;
    setActiveId(null);
  }, []);

  const openChat = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      try {
        const chat = await chatStore.load(id);
        if (!chat) {
          toast.error("That chat is gone");
          await refreshList();
          return;
        }
        activeRef.current = { id: chat.id, createdAt: chat.createdAt };
        setActiveId(chat.id);
        setTurns(turnsFromMessages(chat.messages));
      } catch (error) {
        toast.error("Could not open that chat", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [chatStore, refreshList],
  );

  const deleteChat = useCallback(
    async (id: string) => {
      const chat = await chatStore.load(id).catch(() => null);
      await chatStore.remove(id).catch((error: unknown) => {
        toast.error("Could not delete that chat", {
          description: error instanceof Error ? error.message : undefined,
        });
      });
      // Its files go too; a failure here is not worth a dialog.
      for (const m of chat?.messages ?? []) {
        for (const file of [...m.files, ...m.images]) {
          void deleteChatFile(fileStore, file).catch(() => undefined);
        }
      }
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeRef.current?.id === id) newChat();
    },
    [chatStore, fileStore, newChat],
  );

  /**
   * The history as the server wants it: text plus links. The previous
   * answer's pictures ride along on the new message so they can be edited.
   */
  const wireHistory = useCallback(
    async (history: Turn[], outgoing: { text: string; files: ChatFile[] }) => {
      const prior = history.filter((t) => t.text.trim() || t.files.length > 0);
      const messages: CompassMessage[] = [];
      for (const t of prior) {
        if (t.role === "assistant") {
          messages.push({ role: "assistant", content: t.text });
          continue;
        }
        const attachments = await wireFiles(fileStore, t.files);
        messages.push({ role: "user", content: t.text, attachments });
      }
      const lastAnswer = [...history].reverse().find((t) => t.role === "assistant");
      const carried = (lastAnswer?.images ?? []).flatMap((i) => (i.file ? [i.file] : []));
      const attachments = await wireFiles(fileStore, [...carried, ...outgoing.files]);
      messages.push({ role: "user", content: outgoing.text, attachments });
      return messages;
    },
    [fileStore],
  );

  const run = useCallback(
    async (text: string, files: ChatFile[], history: Turn[]) => {
      const assistantId = newId();
      const userTurn: Turn = {
        id: newId(),
        role: "user",
        text,
        files,
        images: [],
        tools: [],
        proposals: [],
        streaming: false,
      };
      const assistantTurn: Turn = {
        id: assistantId,
        role: "assistant",
        text: "",
        files: [],
        images: [],
        tools: [],
        proposals: [],
        streaming: true,
      };
      setTurns([...history, userTurn, assistantTurn]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fn: (turn: Turn) => Turn) =>
        setTurns((prev) => prev.map((t) => (t.id === assistantId ? fn(t) : t)));

      let messages: CompassMessage[];
      try {
        messages = await wireHistory(history, { text, files });
      } catch (error) {
        patch((t) => ({
          ...t,
          streaming: false,
          error: {
            code: "files",
            message: error instanceof Error ? error.message : "Could not prepare the files.",
            retryable: true,
          },
        }));
        setBusy(false);
        abortRef.current = null;
        return;
      }

      // Pictures as they arrive, by the model's item id, so a partial frame
      // is replaced by the finished one rather than shown beside it.
      const finals = new Map<string, { b64: string; mime: string }>();

      await streamCompass({
        messages,
        snapshot,
        signal: controller.signal,
        onEvent: (event: CompassEvent) => {
          switch (event.type) {
            case "text":
              patch((t) => ({ ...t, text: t.text + event.delta }));
              break;
            case "tool":
              // The painter is retried server-side on another image model;
              // one "Drawing" is enough for all of its tries.
              patch((t) =>
                event.name === "generate_image" &&
                t.tools.some((tool) => tool.name === "generate_image" && !tool.done)
                  ? t
                  : { ...t, tools: [...t.tools, { name: event.name, done: false }] },
              );
              break;
            case "tool_result":
              patch((t) => ({
                ...t,
                tools: t.tools.map((tool) =>
                  tool.name === event.name && !tool.done
                    ? { ...tool, data: event.data, done: true }
                    : tool,
                ),
              }));
              break;
            case "proposal":
              patch((t) => ({ ...t, proposals: [...t.proposals, event.proposal] }));
              break;
            case "image": {
              const src = `data:${event.mime};base64,${event.b64}`;
              if (!event.partial) finals.set(event.id, { b64: event.b64, mime: event.mime });
              patch((t) => {
                const existing = t.images.find((i) => i.id === event.id);
                const next: TurnImage = { id: event.id, src, partial: event.partial };
                return {
                  ...t,
                  images: existing
                    ? t.images.map((i) => (i.id === event.id ? next : i))
                    : [...t.images, next],
                };
              });
              break;
            }
            case "error":
              patch((t) => ({
                ...t,
                // A picture that will not come: the text may still be on its way.
                streaming: event.code.startsWith("image_") ? t.streaming : false,
                tools: event.code.startsWith("image_")
                  ? t.tools.map((tool) =>
                      tool.name === "generate_image" ? { ...tool, done: true } : tool,
                    )
                  : t.tools,
                error: { message: event.message, code: event.code, retryable: event.retryable },
              }));
              break;
            case "done":
              patch((t) => ({ ...t, streaming: false, model: event.model }));
              break;
            default:
              break;
          }
        },
      });

      // Keep what it drew. The data URL stays on screen; the stored file is
      // what the chat remembers and what the next turn sends back.
      const kept = new Map<string, ChatFile>();
      for (const [id, image] of finals) {
        try {
          const blob = base64ToBlob(image.b64, image.mime);
          const file = await storeChatFile(fileStore, blob, {
            kind: "image",
            name: `picture-${id.slice(-6)}.${image.mime === "image/png" ? "png" : image.mime === "image/jpeg" ? "jpg" : "webp"}`,
            mimeType: image.mime,
          });
          kept.set(id, file);
        } catch (error) {
          toast.error("Could not keep that picture", {
            description: error instanceof Error ? error.message : undefined,
          });
        }
      }
      patch((t) => ({
        ...t,
        streaming: false,
        images: t.images.map((i) => (kept.has(i.id) ? { ...i, file: kept.get(i.id) } : i)),
      }));
      setBusy(false);
      abortRef.current = null;

      const finalTurns = turnsRef.current.map((t) =>
        t.id === assistantId
          ? {
              ...t,
              streaming: false,
              images: t.images.map((i) => (kept.has(i.id) ? { ...i, file: kept.get(i.id) } : i)),
            }
          : t,
      );
      await persist(finalTurns);
    },
    [fileStore, persist, snapshot, wireHistory],
  );

  const send = useCallback(
    async (text: string, outgoing: OutgoingFile[] = []) => {
      const clean = text.trim();
      if ((!clean && outgoing.length === 0) || busy) return;

      let stored: ChatFile[] = [];
      if (outgoing.length > 0) {
        setUploading(true);
        try {
          stored = await Promise.all(
            outgoing.map((f) =>
              storeChatFile(fileStore, f.blob, {
                kind: f.kind,
                name: f.name,
                mimeType: f.mimeType,
                width: f.width,
                height: f.height,
              }),
            ),
          );
        } catch (error) {
          toast.error("Could not attach those files", {
            description: error instanceof Error ? error.message : undefined,
          });
          setUploading(false);
          return;
        }
        setUploading(false);
      }

      await run(clean, stored, turnsRef.current);
    },
    [busy, fileStore, run],
  );

  const retry = useCallback(async () => {
    if (busy) return;
    const current = turnsRef.current;
    const lastUser = [...current].reverse().find((t) => t.role === "user");
    if (!lastUser) return;
    const at = current.lastIndexOf(lastUser);
    await run(lastUser.text, lastUser.files, current.slice(0, at));
  }, [busy, run]);

  return {
    turns,
    busy,
    uploading,
    send,
    stop,
    retry,
    chats,
    activeId,
    chatsReady,
    newChat,
    openChat,
    deleteChat,
    fileStore,
  };
}

async function wireFiles(store: FileStore, files: ChatFile[]): Promise<WireAttachment[]> {
  return Promise.all(
    files.map(async (file) => ({
      kind: file.kind,
      name: file.name,
      url: await chatFileWireUrl(store, file),
    })),
  );
}

/**
 * Where conversations are kept.
 *
 * Signed in: the `chats` table, one row per conversation, messages as JSON,
 * owner-only by Row Level Security (`supabase/migrations/0006_chat.sql`).
 * A chat started on the Chromebook is there on the Mac.
 *
 * No Supabase project, or one where that migration has not been applied yet:
 * localStorage on this device, under the user's id. The switch is automatic
 * and logged once, so a missing table degrades to "chats stay on this
 * device" rather than to "chats vanish".
 */

import { getSupabase } from "@/lib/auth/client";
import { nowISO } from "@/lib/core/time";

import type { Chat, ChatSummary } from "./types";

export interface ChatStore {
  list(): Promise<ChatSummary[]>;
  load(id: string): Promise<Chat | null>;
  save(chat: Chat): Promise<void>;
  remove(id: string): Promise<void>;
}

const MAX_LOCAL_CHATS = 200;

export function localKey(userId: string): string {
  return `aaditos:chats:${userId}`;
}

export class LocalChatStore implements ChatStore {
  constructor(private readonly userId: string) {}

  private read(): Chat[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(localKey(this.userId));
      const parsed = raw ? (JSON.parse(raw) as { chats?: Chat[] }) : {};
      return Array.isArray(parsed.chats) ? parsed.chats : [];
    } catch {
      return [];
    }
  }

  private write(chats: Chat[]): void {
    if (typeof window === "undefined") return;
    const trimmed = [...chats]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_LOCAL_CHATS);
    window.localStorage.setItem(localKey(this.userId), JSON.stringify({ chats: trimmed }));
  }

  async list(): Promise<ChatSummary[]> {
    return this.read()
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<Chat | null> {
    return this.read().find((c) => c.id === id) ?? null;
  }

  async save(chat: Chat): Promise<void> {
    const rest = this.read().filter((c) => c.id !== chat.id);
    this.write([chat, ...rest]);
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((c) => c.id !== id));
  }
}

/** Postgres "relation does not exist", or PostgREST's "not in the schema cache". */
function tableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /chats/.test(error.message ?? "");
}

export class SupabaseChatStore implements ChatStore {
  private fallback: LocalChatStore;
  private missing = false;

  constructor(private readonly userId: string) {
    this.fallback = new LocalChatStore(userId);
  }

  private db() {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured.");
    return client;
  }

  private noteMissing(): void {
    if (this.missing) return;
    this.missing = true;
    console.warn(
      "[chat] the chats table is not there yet; keeping conversations on this device. Apply supabase/migrations/0006_chat.sql to sync them.",
    );
  }

  async list(): Promise<ChatSummary[]> {
    if (this.missing) return this.fallback.list();
    const { data, error } = await this.db()
      .from("chats")
      .select("id,title,updated_at")
      .eq("user_id", this.userId)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) {
      if (tableMissing(error)) {
        this.noteMissing();
        return this.fallback.list();
      }
      throw new Error(`list chats: ${error.message}`);
    }
    return (data ?? []).map((row) => ({
      id: String(row["id"]),
      title: String(row["title"] ?? "New chat"),
      updatedAt: String(row["updated_at"]),
    }));
  }

  async load(id: string): Promise<Chat | null> {
    if (this.missing) return this.fallback.load(id);
    const { data, error } = await this.db()
      .from("chats")
      .select("id,title,messages,created_at,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (tableMissing(error)) {
        this.noteMissing();
        return this.fallback.load(id);
      }
      throw new Error(`load chat: ${error.message}`);
    }
    if (!data) return null;
    return {
      id: String(data["id"]),
      title: String(data["title"] ?? "New chat"),
      messages: Array.isArray(data["messages"]) ? (data["messages"] as Chat["messages"]) : [],
      createdAt: String(data["created_at"]),
      updatedAt: String(data["updated_at"]),
    };
  }

  async save(chat: Chat): Promise<void> {
    if (this.missing) return this.fallback.save(chat);
    const { error } = await this.db()
      .from("chats")
      .upsert(
        {
          id: chat.id,
          user_id: this.userId,
          title: chat.title,
          messages: chat.messages,
          created_at: chat.createdAt,
          updated_at: chat.updatedAt || nowISO(),
        },
        { onConflict: "id" },
      );
    if (error) {
      if (tableMissing(error)) {
        this.noteMissing();
        return this.fallback.save(chat);
      }
      throw new Error(`save chat: ${error.message}`);
    }
  }

  async remove(id: string): Promise<void> {
    if (this.missing) return this.fallback.remove(id);
    const { error } = await this.db().from("chats").delete().eq("id", id);
    if (error) {
      if (tableMissing(error)) {
        this.noteMissing();
        return this.fallback.remove(id);
      }
      throw new Error(`delete chat: ${error.message}`);
    }
  }
}

export function chatStoreFor(userId: string): ChatStore {
  return getSupabase() ? new SupabaseChatStore(userId) : new LocalChatStore(userId);
}

/**
 * Conversations kept on the device, which is also what signed-in users get
 * until the chats migration is applied.
 */

import { describe, expect, it } from "vitest";

import { LocalChatStore, localKey } from "@/lib/chat/store";
import { titleFor, type Chat } from "@/lib/chat/types";

function chat(id: string, title: string, updatedAt: string): Chat {
  return { id, title, messages: [], createdAt: updatedAt, updatedAt };
}

describe("LocalChatStore", () => {
  it("lists newest first and loads what it saved", async () => {
    const store = new LocalChatStore("u1");
    await store.save(chat("a", "First", "2026-10-27T10:00:00.000Z"));
    await store.save(chat("b", "Second", "2026-10-27T11:00:00.000Z"));
    expect((await store.list()).map((c) => c.id)).toEqual(["b", "a"]);
    expect((await store.load("a"))?.title).toBe("First");
    expect(await store.load("zzz")).toBeNull();
  });

  it("replaces a chat with the same id rather than duplicating it", async () => {
    const store = new LocalChatStore("u1");
    await store.save(chat("a", "First", "2026-10-27T10:00:00.000Z"));
    await store.save(chat("a", "Renamed", "2026-10-27T12:00:00.000Z"));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("Renamed");
  });

  it("removes, and keeps users apart", async () => {
    const mine = new LocalChatStore("u1");
    const theirs = new LocalChatStore("u2");
    await mine.save(chat("a", "Mine", "2026-10-27T10:00:00.000Z"));
    await theirs.save(chat("b", "Theirs", "2026-10-27T10:00:00.000Z"));
    await mine.remove("a");
    expect(await mine.list()).toEqual([]);
    expect((await theirs.list()).map((c) => c.id)).toEqual(["b"]);
    expect(window.localStorage.getItem(localKey("u2"))).toContain("Theirs");
  });

  it("survives a corrupt record", async () => {
    window.localStorage.setItem(localKey("u1"), "{not json");
    expect(await new LocalChatStore("u1").list()).toEqual([]);
  });
});

describe("titleFor", () => {
  it("uses the first line, cleaned and shortened", () => {
    expect(titleFor("**What** is due\nthis week?")).toBe("What is due this week?");
    expect(titleFor("x".repeat(80))).toHaveLength(56);
    expect(titleFor("   ", "About sheet.jpg")).toBe("About sheet.jpg");
  });
});

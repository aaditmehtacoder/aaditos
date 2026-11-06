import { describe, expect, it } from "vitest";

import { migrateStorageKeys, storageKey } from "@/lib/storage-keys";

describe("migrateStorageKeys", () => {
  it("moves the app's own keys from the old prefix and keeps their values", () => {
    const old = ["aadit", "os:"].join("");
    localStorage.setItem(`${old}chats:user-1`, '{"chats":[1]}');
    localStorage.setItem(`${old}v1:workspace:user-1`, "{}");
    localStorage.setItem(`${old}theme`, "dark");
    migrateStorageKeys(localStorage);
    expect(localStorage.getItem(storageKey("chats:user-1"))).toBe('{"chats":[1]}');
    expect(localStorage.getItem(storageKey("v1:workspace:user-1"))).toBe("{}");
    expect(localStorage.getItem(storageKey("theme"))).toBe("dark");
    expect(localStorage.getItem(`${old}chats:user-1`)).toBeNull();
  });

  it("never touches keys the hosting site keeps on the same origin", () => {
    localStorage.setItem("i18n:lang", "en");
    localStorage.setItem("somecode:usage", "[]");
    localStorage.setItem("macos:theme-ish", "x");
    migrateStorageKeys(localStorage);
    expect(localStorage.getItem("i18n:lang")).toBe("en");
    expect(localStorage.getItem("somecode:usage")).toBe("[]");
    expect(localStorage.getItem("macos:theme-ish")).toBe("x");
  });

  it("lets a newer value under the new prefix win", () => {
    const old = ["aadit", "os:"].join("");
    localStorage.setItem(`${old}theme`, "dark");
    localStorage.setItem(storageKey("theme"), "light");
    migrateStorageKeys(localStorage);
    expect(localStorage.getItem(storageKey("theme"))).toBe("light");
    expect(localStorage.getItem(`${old}theme`)).toBeNull();
  });
});

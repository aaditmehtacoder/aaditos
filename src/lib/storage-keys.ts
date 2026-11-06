/**
 * Every key the app keeps in browser storage, under one neutral prefix.
 *
 * The app shares its origin with the site that hosts it, so every key is
 * prefixed; and the prefix says nothing about whose app this is.
 */

export const STORAGE_PREFIX = "planner:";

export function storageKey(name: string): string {
  return `${STORAGE_PREFIX}${name}`;
}

/**
 * Keys this app wrote under its previous prefix: `<name>os:` followed by one
 * of the key names below. Matching the key names keeps the move from ever
 * touching something the hosting site stored on the same origin.
 */
const PREVIOUS =
  /^[a-z]{2,16}os:(?=v1:workspace:|chats:|theme$|client-id$|inbox-dismissed$|last-route$)/;

/**
 * Moves keys from the previous prefix to the current one, so the chats and
 * settings already on this device survive the rename. Runs before anything
 * reads storage; costs one pass over the keys and is a no-op once done. A key
 * already present under the new prefix is newer and wins.
 */
export function migrateStorageKeys(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  try {
    const moves: Array<[string, string]> = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && PREVIOUS.test(key)) moves.push([key, key.replace(PREVIOUS, STORAGE_PREFIX)]);
    }
    for (const [from, to] of moves) {
      const value = storage.getItem(from);
      if (value !== null && storage.getItem(to) === null) storage.setItem(to, value);
      storage.removeItem(from);
    }
  } catch {
    // Storage blocked or full: the app still runs, it just starts fresh here.
  }
}

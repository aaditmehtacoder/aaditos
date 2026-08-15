/** Id helpers. Seed rows use deterministic ids so re-seeding never duplicates. */

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    return formatUuid(Array.from(bytes));
  }
  // Last-resort fallback for exotic runtimes; never used in browsers or Node 19+.
  const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  hex[6] = ((hex[6] ?? 0) & 0x0f) | 0x40;
  hex[8] = ((hex[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(hex);
}

function formatUuid(bytes: number[]): string {
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Deterministic UUID-shaped id derived from a string. Used for demo seed rows
 * and for imported records so repeated syncs are idempotent.
 */
export function stableId(input: string): string {
  const bytes: number[] = [];
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 + code + i, 2654435761) >>> 0;
  }
  for (let i = 0; i < 16; i += 1) {
    h1 = Math.imul(h1 ^ (h1 >>> 15), 2246822507) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909) >>> 0;
    bytes.push((h1 ^ h2 ^ (i * 31)) & 0xff);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}

/** Non-reversible identifier for OpenAI's `safety_identifier`. */
export async function hashIdentifier(value: string, salt: string): Promise<string> {
  const c = globalThis.crypto;
  if (c && c.subtle) {
    const data = new TextEncoder().encode(`${salt}:${value}`);
    const digest = await c.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  }
  return stableId(`${salt}:${value}`).replace(/-/g, "");
}

/**
 * Where the Google refresh token lives.
 *
 * In an httpOnly, sealed cookie — AES-GCM encrypted with `TOKEN_ENCRYPTION_KEY`
 * and never readable from JavaScript. That keeps the only long-lived Google
 * secret off the client and out of any database, which matters because the
 * default AaditOS deployment has no database at all.
 *
 * The sealing is done here rather than by the framework: TanStack Start
 * dropped its h3-backed `useSession` helpers, and a cookie this app encrypts
 * itself has no framework version to drift with. Without
 * `TOKEN_ENCRYPTION_KEY` the connect flow refuses to start rather than writing
 * a token somewhere unencrypted.
 */

import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { decryptSecret, encryptSecret, serverEnv } from "./env";

export interface GoogleSessionData {
  refreshToken?: string | undefined;
  email?: string | undefined;
  scope?: string | undefined;
  connectedAt?: string | undefined;
  /** Anti-CSRF value for the in-flight consent round trip. */
  oauthState?: string | undefined;
}

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "TOKEN_ENCRYPTION_KEY is not set. AaditOS will not store a Google refresh token without it.",
    );
    this.name = "EncryptionKeyMissingError";
  }
}

const COOKIE = "aaditos_google";
const MAX_AGE = 60 * 60 * 24 * 180;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: MAX_AGE,
};

export function encryptionReady(): boolean {
  const key = serverEnv.tokenEncryptionKey;
  return Boolean(key && key.length >= 32);
}

function requireKey(): void {
  if (!encryptionReady()) throw new EncryptionKeyMissingError();
}

export async function readGoogleSession(): Promise<GoogleSessionData> {
  if (!encryptionReady()) return {};
  try {
    const sealed = getCookie(COOKIE);
    if (!sealed) return {};
    const parsed = JSON.parse(await decryptSecret(sealed)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as GoogleSessionData) : {};
  } catch {
    // A key rotation, a cookie from the old framework format, or tampering:
    // every one of these reads as "not connected".
    return {};
  }
}

export async function writeGoogleSession(patch: GoogleSessionData): Promise<void> {
  requireKey();
  const current = await readGoogleSession();
  const next: GoogleSessionData = { ...current, ...patch };
  // `undefined` in a patch means "remove"; JSON would drop it anyway, but be explicit.
  for (const key of Object.keys(next) as Array<keyof GoogleSessionData>) {
    if (next[key] === undefined) delete next[key];
  }
  setCookie(COOKIE, await encryptSecret(JSON.stringify(next)), COOKIE_OPTIONS);
}

export async function clearGoogleSession(): Promise<void> {
  deleteCookie(COOKIE, { path: "/" });
}

/**
 * Where the Google refresh token lives.
 *
 * In an httpOnly, sealed session cookie — encrypted with `TOKEN_ENCRYPTION_KEY`
 * and never readable from JavaScript. That keeps the only long-lived Google
 * secret off the client and out of any database, which matters because the
 * default AaditOS deployment has no database at all.
 *
 * Without `TOKEN_ENCRYPTION_KEY` the connect flow refuses to start rather than
 * writing a token somewhere unencrypted.
 */

import { getSession, updateSession } from "@tanstack/react-start/server";

import { serverEnv } from "./env";

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

function config() {
  const password = serverEnv.tokenEncryptionKey;
  if (!password || password.length < 32) {
    throw new EncryptionKeyMissingError();
  }
  return {
    name: "aaditos_google",
    password,
    cookie: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    },
  };
}

export function encryptionReady(): boolean {
  const key = serverEnv.tokenEncryptionKey;
  return Boolean(key && key.length >= 32);
}

export async function readGoogleSession(): Promise<GoogleSessionData> {
  if (!encryptionReady()) return {};
  try {
    const session = await getSession<GoogleSessionData>(config());
    return session.data ?? {};
  } catch {
    // A key rotation invalidates old cookies; treat that as "not connected".
    return {};
  }
}

export async function writeGoogleSession(patch: GoogleSessionData): Promise<void> {
  await updateSession<GoogleSessionData>(config(), (current) => ({ ...current, ...patch }));
}

export async function clearGoogleSession(): Promise<void> {
  await updateSession<GoogleSessionData>(config(), () => ({}));
}

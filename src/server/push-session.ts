/**
 * Who a push belongs to.
 *
 * The service worker fetches `/api/push/next` when a push arrives, and it has no
 * access to the Supabase access token — that lives in the page, which may not be
 * running at all. All it can send is cookies.
 *
 * So enabling push writes a sealed, httpOnly cookie holding just the user id,
 * encrypted with `TOKEN_ENCRYPTION_KEY` exactly like the Google session. The
 * worker's `credentials: "include"` fetch carries it, and the endpoint learns
 * who is asking without ever trusting a value the client could set.
 *
 * The cookie holds an id and nothing else: no token, no email, nothing that
 * grants access anywhere but this one endpoint.
 */

import { getSession, updateSession } from "@tanstack/react-start/server";

import { serverEnv } from "./env";

export interface PushSessionData {
  userId?: string | undefined;
}

function config() {
  const password = serverEnv.tokenEncryptionKey;
  if (!password || password.length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required before a push session can be sealed.");
  }
  return {
    name: "aaditos_push",
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

export async function readPushSession(): Promise<PushSessionData> {
  try {
    const session = await getSession<PushSessionData>(config());
    return session.data ?? {};
  } catch {
    // Missing key or a rotated one: treat as "no push session".
    return {};
  }
}

export async function writePushSession(userId: string): Promise<void> {
  await updateSession<PushSessionData>(config(), () => ({ userId }));
}

export async function clearPushSession(): Promise<void> {
  await updateSession<PushSessionData>(config(), () => ({}));
}

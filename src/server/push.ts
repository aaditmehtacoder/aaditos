/**
 * Web push, without the payload encryption.
 *
 * A normal web push encrypts its payload with aes128gcm, which means ECDH
 * against the subscription's `p256dh` key, HKDF, a padded record layout, and a
 * content-encoding header — all of which fail *silently* when subtly wrong.
 *
 * This sends an empty push instead: a "tickle" that carries no body. The service
 * worker receives it and fetches the actual notification text from
 * `/api/push/next` over the user's own authenticated session. Two consequences,
 * both good:
 *
 *   - There is nothing to encrypt, so the whole failure surface disappears.
 *   - The push service (Google, Mozilla, Apple) never sees what the notification
 *     says. It only learns that *a* notification happened.
 *
 * What still has to be right is VAPID: a short-lived ES256 JWT proving the push
 * came from this server. That part is signed below with WebCrypto.
 */

import { serverEnv } from "./env";

export interface PushSubscriptionRecord {
  endpoint: string;
  /** Present for real subscriptions; unused here since nothing is encrypted. */
  p256dh?: string | undefined;
  auth?: string | undefined;
}

export function pushConfigured(): boolean {
  return Boolean(serverEnv.vapidPublicKey && serverEnv.vapidPrivateKey);
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function privateKey(): Promise<CryptoKey> {
  const raw = serverEnv.vapidPrivateKey;
  if (!raw) throw new Error("VAPID_PRIVATE_KEY is not set.");
  return crypto.subtle.importKey(
    "pkcs8",
    b64urlToBytes(raw) as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * The VAPID Authorization header for one push origin.
 *
 * `aud` must be the push service's origin — not the full endpoint URL. Sending
 * the whole endpoint is the classic mistake and earns a 401.
 */
export async function vapidHeader(endpoint: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    // Push services reject anything more than 24h out; 12h leaves slack.
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: serverEnv.vapidSubject ?? "mailto:admin@localhost",
  };

  const signingInput = `${bytesToB64url(new TextEncoder().encode(JSON.stringify(header)))}.${bytesToB64url(
    new TextEncoder().encode(JSON.stringify(claims)),
  )}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await privateKey(),
    new TextEncoder().encode(signingInput),
  );

  // WebCrypto already returns the raw r||s pair ES256 wants — no DER unwrapping.
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(signature))}`;
  return `vapid t=${jwt}, k=${serverEnv.vapidPublicKey}`;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** True when the subscription is dead and should be deleted, not retried. */
  expired: boolean;
  message?: string | undefined;
}

/** Sends one payload-less push. The service worker fetches the content itself. */
export async function sendPush(subscription: PushSubscriptionRecord): Promise<PushResult> {
  if (!pushConfigured()) {
    return { ok: false, status: 0, expired: false, message: "VAPID keys are not configured." };
  }

  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization: await vapidHeader(subscription.endpoint),
        // Required even with no body, or the push service returns 400.
        "content-length": "0",
        ttl: "3600",
        urgency: "normal",
      },
      signal: AbortSignal.timeout(10_000),
    });

    // 404/410 mean the browser threw the subscription away — the endpoint will
    // never work again, so the caller should delete rather than retry it.
    const expired = response.status === 404 || response.status === 410;
    return {
      ok: response.ok,
      status: response.status,
      expired,
      message: response.ok ? undefined : `Push service returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      expired: false,
      message: error instanceof Error ? error.message : "Push request failed.",
    };
  }
}

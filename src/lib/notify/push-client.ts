/**
 * Browser side of web push.
 *
 * Subscribing is a two-step handshake that fails in confusing ways if either
 * half is skipped: the browser mints a subscription against the server's VAPID
 * public key, and the server has to store the resulting endpoint or it will
 * never be able to push to it. Both steps happen here, together.
 */

/** VAPID keys travel as base64url; `applicationServerKey` needs raw bytes. */
function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToB64url(buffer: ArrayBuffer | null): string | undefined {
  if (!buffer) return undefined;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PushAvailability {
  /** The browser can do push at all. */
  supported: boolean;
  /** The server has VAPID keys. */
  configured: boolean;
  /** This device already has a live subscription. */
  subscribed: boolean;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function pushStatus(): Promise<PushAvailability> {
  if (!pushSupported()) return { supported: false, configured: false, subscribed: false };

  let configured = false;
  try {
    const response = await fetch("/api/push/subscribe");
    configured = Boolean(((await response.json()) as { configured?: boolean }).configured);
  } catch {
    configured = false;
  }

  let subscribed = false;
  try {
    const registration = await navigator.serviceWorker.ready;
    subscribed = Boolean(await registration.pushManager.getSubscription());
  } catch {
    subscribed = false;
  }

  return { supported: true, configured, subscribed };
}

export interface SubscribeResult {
  ok: boolean;
  message?: string;
}

/**
 * @param accessToken the Supabase access token, used once to prove who is
 * subscribing. The server verifies it rather than trusting a client-sent id.
 */
export async function subscribeToPush(accessToken: string | undefined): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, message: "This browser cannot receive push." };
  if (!accessToken) return { ok: false, message: "Sign in before enabling push." };

  let publicKey: string | null = null;
  try {
    const response = await fetch("/api/push/subscribe");
    const data = (await response.json()) as { configured?: boolean; publicKey?: string | null };
    if (!data.configured || !data.publicKey) {
      return { ok: false, message: "Push is not configured on the server yet." };
    }
    publicKey = data.publicKey;
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Reuse an existing subscription rather than minting a second one; a device
    // with two subscriptions receives every notification twice.
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Chrome refuses a subscription without this, even for VAPID.
        userVisibleOnly: true,
        applicationServerKey: b64urlToBytes(publicKey) as BufferSource,
      }));

    const keys = subscription.toJSON().keys ?? {};
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: keys["p256dh"] ?? bytesToB64url(subscription.getKey("p256dh")),
        auth: keys["auth"] ?? bytesToB64url(subscription.getKey("auth")),
        userAgent: navigator.userAgent.slice(0, 300),
      }),
    });

    const result = (await response.json()) as { ok?: boolean; message?: string };
    if (!result.ok) {
      // The server could not store it, so it will never push here. Drop the
      // local subscription rather than leaving a dead one that looks live.
      await subscription.unsubscribe().catch(() => {});
      return { ok: false, message: result.message ?? "Could not register this device." };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not subscribe to push.",
    };
  }
}

export async function unsubscribeFromPush(
  accessToken: string | undefined,
): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: true };
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ok: true };

    // Tell the server first: if the local unsubscribe succeeded but the server
    // kept the row, it would keep pushing to a dead endpoint forever.
    if (accessToken) {
      await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
    await subscription.unsubscribe();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not unsubscribe.",
    };
  }
}

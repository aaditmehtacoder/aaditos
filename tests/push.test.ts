/**
 * VAPID signing.
 *
 * This is the part of web push that fails silently. A malformed JWT does not
 * throw anywhere in our code — the push service just answers 401 and the
 * notification never arrives, with nothing in any log to explain it. So the
 * signature is actually verified here against the public key, rather than
 * merely checking that a string of three dot-separated parts came out.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pushConfigured, vapidHeader } from "@/server/push";

/** A throwaway keypair, generated per run — never the project's real one. */
async function generateKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const b64url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return {
    publicKey: b64url(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateKey: b64url(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    publicCryptoKey: pair.publicKey,
  };
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const ORIGINAL = { ...process.env };
let keys: Awaited<ReturnType<typeof generateKeys>>;

beforeEach(async () => {
  keys = await generateKeys();
  process.env["VAPID_PUBLIC_KEY"] = keys.publicKey;
  process.env["VAPID_PRIVATE_KEY"] = keys.privateKey;
  process.env["VAPID_SUBJECT"] = "mailto:test@example.com";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123:XYZ-token_here";

describe("pushConfigured", () => {
  it("is false without a private key, so the caller can degrade instead of 401-ing", () => {
    delete process.env["VAPID_PRIVATE_KEY"];
    expect(pushConfigured()).toBe(false);
  });

  it("is true once both keys are present", () => {
    expect(pushConfigured()).toBe(true);
  });
});

describe("vapidHeader", () => {
  it("uses the vapid scheme and carries both the token and the key", async () => {
    const header = await vapidHeader(ENDPOINT);
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(header).toContain(keys.publicKey);
  });

  /**
   * The classic VAPID mistake: sending the full endpoint URL as `aud`. Push
   * services require the origin alone and reject anything else with a 401 that
   * looks identical to a bad signature.
   */
  it("sets aud to the push service ORIGIN, not the full endpoint", async () => {
    const header = await vapidHeader(ENDPOINT);
    const claims = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(header.split("t=")[1]!.split(",")[0]!.split(".")[1]!)),
    ) as { aud: string };
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.aud).not.toContain("/fcm/send");
  });

  it("declares ES256, which is the only algorithm VAPID allows", async () => {
    const header = await vapidHeader(ENDPOINT);
    const jwtHeader = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(header.split("t=")[1]!.split(",")[0]!.split(".")[0]!)),
    ) as { alg: string; typ: string };
    expect(jwtHeader.alg).toBe("ES256");
    expect(jwtHeader.typ).toBe("JWT");
  });

  it("expires in the future but inside the 24h services allow", async () => {
    const header = await vapidHeader(ENDPOINT);
    const claims = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(header.split("t=")[1]!.split(",")[0]!.split(".")[1]!)),
    ) as { exp: number; sub: string };
    const now = Math.floor(Date.now() / 1000);
    expect(claims.exp).toBeGreaterThan(now);
    expect(claims.exp).toBeLessThanOrEqual(now + 24 * 3600);
    expect(claims.sub).toBe("mailto:test@example.com");
  });

  /**
   * ES256 wants the raw 64-byte r||s pair. Some crypto stacks hand back a DER
   * SEQUENCE instead, which is the same signature in a form push services will
   * not accept — and the length is what distinguishes them.
   */
  it("signs with a raw 64-byte r||s pair, not DER", async () => {
    const header = await vapidHeader(ENDPOINT);
    const signature = header.split("t=")[1]!.split(",")[0]!.split(".")[2]!;
    expect(b64urlToBytes(signature).length).toBe(64);
  });

  /** The real proof: the signature verifies against the advertised public key. */
  it("produces a signature that verifies against the public key", async () => {
    const header = await vapidHeader(ENDPOINT);
    const jwt = header.split("t=")[1]!.split(",")[0]!;
    const [h, c, s] = jwt.split(".");

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.publicCryptoKey,
      b64urlToBytes(s!) as BufferSource,
      new TextEncoder().encode(`${h}.${c}`) as BufferSource,
    );
    expect(verified).toBe(true);
  });

  it("rejects a tampered claim set", async () => {
    const header = await vapidHeader(ENDPOINT);
    const jwt = header.split("t=")[1]!.split(",")[0]!;
    const [h, , s] = jwt.split(".");
    const forged = btoa(JSON.stringify({ aud: "https://evil.example", exp: 9e9, sub: "mailto:x" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.publicCryptoKey,
      b64urlToBytes(s!) as BufferSource,
      new TextEncoder().encode(`${h}.${forged}`) as BufferSource,
    );
    expect(verified).toBe(false);
  });

  it("targets each push service separately, since aud is per-origin", async () => {
    const fcm = await vapidHeader("https://fcm.googleapis.com/fcm/send/a");
    const mozilla = await vapidHeader("https://updates.push.services.mozilla.com/wpush/v2/b");
    expect(fcm).not.toBe(mozilla);
  });
});

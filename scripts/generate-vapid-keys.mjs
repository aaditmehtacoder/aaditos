#!/usr/bin/env node
/**
 * Generates the VAPID keypair that identifies this server to push services.
 *
 * VAPID is P-256 ECDSA. The public key goes to the browser (it is baked into the
 * subscription) and the private key stays on the server, where it signs a short
 * JWT proving the push came from us. Neither key encrypts anything — this app
 * sends payload-less pushes, so there is no content to encrypt.
 *
 * Run once. Rotating the keys invalidates every existing subscription, so every
 * device has to re-subscribe.
 *
 *   node scripts/generate-vapid-keys.mjs
 */

import { webcrypto as crypto } from "node:crypto";

const b64url = (buffer) =>
  Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);

// The public key must be the uncompressed 65-byte point (0x04 || X || Y), which
// is what `raw` gives. Push services reject anything else.
const publicKey = b64url(await crypto.subtle.exportKey("raw", keys.publicKey));
// The private key travels as PKCS#8 so it can be re-imported with one call.
const privateKey = b64url(await crypto.subtle.exportKey("pkcs8", keys.privateKey));

console.log("Add these to .env (and to your host's environment):\n");
console.log(`VITE_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com`);
console.log(
  "\nVITE_VAPID_PUBLIC_KEY is public by design — it ships to the browser.\n" +
    "VAPID_PRIVATE_KEY is a secret. Never commit it.",
);

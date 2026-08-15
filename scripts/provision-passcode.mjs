#!/usr/bin/env node
/**
 * Provisions passcode sign-in on the Supabase accounts.
 *
 * The three accounts were created by Google sign-in, so they have no password
 * at all. This sets each one's derived password (see src/server/passcode.ts)
 * through the Admin API, on the *same user rows* — so every existing task,
 * event and RLS policy keeps working, and Google sign-in keeps working too.
 * The accounts simply gain a second way in.
 *
 * Idempotent: running it again just re-sets the same derived password.
 *
 *   bun run passcode:provision
 */

import { createHmac, createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ACCOUNTS = ["aaditmehtacoder@gmail.com", "aaditmehta1@gmail.com", "s182194@scusd.net"];

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  } catch {
    /* no .env: rely on the real environment */
  }
  return env;
}

const env = loadEnv();
const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const secret = (env.ACCOUNT_PASSWORD_SECRET ?? "").trim();

for (const [name, value] of [
  ["VITE_SUPABASE_URL", url],
  ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
  ["ACCOUNT_PASSWORD_SECRET", secret],
]) {
  if (!value) {
    console.error(`✗ ${name} is not set. Nothing was changed.`);
    process.exit(1);
  }
}

/** Must match derivePassword() in src/server/passcode.ts exactly. */
function derivePassword(email) {
  return createHmac("sha256", secret)
    .update(`aaditos:account:${email.toLowerCase()}`)
    .digest("hex")
    .slice(0, 48);
}

const admin = (path, init = {}) =>
  fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      ...(init.headers ?? {}),
    },
  });

async function findUser(email) {
  const res = await admin(`/admin/users?page=1&per_page=200`);
  if (!res.ok) throw new Error(`listing users failed: HTTP ${res.status} ${await res.text()}`);
  const { users = [] } = await res.json();
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

let failed = 0;

for (const email of ACCOUNTS) {
  try {
    const user = await findUser(email);
    if (!user) {
      console.error(`✗ ${email} — no such Supabase user. Sign in with Google once first.`);
      failed += 1;
      continue;
    }

    const res = await admin(`/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ password: derivePassword(email), email_confirm: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);

    // Prove it: the same password grant the app will use at sign-in time.
    const anonKey = (env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "").trim();
    const check = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email, password: derivePassword(email) }),
    });
    const body = await check.json().catch(() => ({}));
    if (!check.ok || !body.access_token) {
      throw new Error(
        `password set but sign-in check failed: ${JSON.stringify(body).slice(0, 200)}`,
      );
    }

    console.log(`✓ ${email} — password set and sign-in verified (user ${user.id})`);
  } catch (error) {
    console.error(`✗ ${email} — ${error.message}`);
    failed += 1;
  }
}

const fingerprint = createHash("sha256").update(secret).digest("hex").slice(0, 12);
console.log(`\nsecret fingerprint ${fingerprint} · passcode "${env.APP_PASSCODE ?? "(unset)"}"`);
process.exit(failed > 0 ? 1 : 0);

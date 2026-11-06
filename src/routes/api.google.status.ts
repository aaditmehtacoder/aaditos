import { createFileRoute } from "@tanstack/react-router";

import { GMAIL_SCOPE } from "@/server/providers/gmail";
import { GOOGLE_SCOPES, googleConfigured } from "@/server/providers/google";
import {
  MAX_GOOGLE_ACCOUNTS,
  encryptionReady,
  mainAccount,
  readGoogleAccounts,
  removeGoogleAccount,
  type GoogleAccount,
} from "@/server/google-session";

/**
 * Connection state, and disconnect.
 *
 * Only booleans and account addresses are returned — never a refresh token.
 * The top-level fields describe the main account (the one Calendar and
 * Classroom read from); `accounts` lists every connected one.
 *
 * `missingScopes` matters more than it looks: a token granted before a new
 * scope was added keeps working for everything it already covered, and fails
 * only on the new capability. Without this, adding Gmail or calendar writes
 * looks like a broken feature rather than a consent that needs redoing.
 */
export const Route = createFileRoute("/api/google/status")({
  server: {
    handlers: {
      GET: async () => json(await status(await readGoogleAccounts())),
      /** `?email=` disconnects one account; without it, every account. */
      DELETE: async ({ request }) => {
        const email = new URL(request.url).searchParams.get("email") ?? undefined;
        return json(await status(await removeGoogleAccount(email)));
      },
    },
  },
});

async function status(accounts: GoogleAccount[]) {
  const main = mainAccount(accounts);
  const granted = main ? main.scope.split(" ").filter(Boolean) : [];
  const connected = Boolean(main);
  return {
    configured: googleConfigured(),
    encryptionReady: encryptionReady(),
    connected,
    email: main?.email ?? null,
    connectedAt: main?.connectedAt ?? null,
    scopes: granted,
    missingScopes: connected ? missingScopes(granted) : [],
    gmail: connected && granted.includes(GMAIL_SCOPE),
    maxAccounts: MAX_GOOGLE_ACCOUNTS,
    accounts: accounts.map((a) => ({
      email: a.email ?? null,
      connectedAt: a.connectedAt ?? null,
      main: a === main,
      gmail: a.scope.split(" ").includes(GMAIL_SCOPE),
      calendar: /calendar/.test(a.scope),
    })),
  };
}

/**
 * Which requested scopes the stored token does not actually carry.
 *
 * Google does not echo scopes back verbatim: `email` and `openid` come back as
 * `.../auth/userinfo.email` and `openid`. Comparing the raw strings therefore
 * reports identity scopes as missing on every single connection, which would
 * make the reconnect prompt permanent and meaningless. Only the scopes that
 * gate a real capability are compared, after normalizing those aliases.
 */
export function missingScopes(granted: string[]): string[] {
  const ALIASES: Record<string, string[]> = {
    email: ["email", "https://www.googleapis.com/auth/userinfo.email"],
    openid: ["openid"],
  };
  const held = new Set(granted);
  return GOOGLE_SCOPES.filter((scope) => {
    const accepted = ALIASES[scope] ?? [scope];
    return !accepted.some((alias) => held.has(alias));
  });
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

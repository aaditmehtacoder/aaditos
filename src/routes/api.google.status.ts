import { createFileRoute } from "@tanstack/react-router";

import { GOOGLE_SCOPES, googleConfigured } from "@/server/providers/google";
import { clearGoogleSession, encryptionReady, readGoogleSession } from "@/server/google-session";

/**
 * Connection state, and disconnect.
 *
 * Only booleans and the account email are returned — never the refresh token.
 *
 * `missingScopes` matters more than it looks: a token granted before a new
 * scope was added keeps working for everything it already covered, and fails
 * only on the new capability. Without this, adding Gmail or calendar writes
 * looks like a broken feature rather than a consent that needs redoing.
 */
export const Route = createFileRoute("/api/google/status")({
  server: {
    handlers: {
      GET: async () => {
        const session = await readGoogleSession();
        const granted = session.scope ? session.scope.split(" ").filter(Boolean) : [];
        const connected = Boolean(session.refreshToken);
        return json({
          configured: googleConfigured(),
          encryptionReady: encryptionReady(),
          connected,
          email: session.email ?? null,
          connectedAt: session.connectedAt ?? null,
          scopes: granted,
          missingScopes: connected ? missingScopes(granted) : [],
        });
      },
      DELETE: async () => {
        await clearGoogleSession();
        return json({ ok: true, connected: false });
      },
    },
  },
});

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

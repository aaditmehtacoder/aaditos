import { createFileRoute } from "@tanstack/react-router";

import { withBase } from "@/lib/base-path";
import { exchangeCode } from "@/server/providers/google";
import {
  MAX_GOOGLE_ACCOUNTS,
  readGoogleAccounts,
  readOauthState,
  saveGoogleAccount,
} from "@/server/google-session";

import { googleRedirectUri } from "./api.google.auth";

/**
 * Completes the Google consent round trip.
 *
 * The `state` value is compared against the one stored in the sealed session,
 * so a consent response that did not originate from this browser is rejected.
 * The account is added next to any already connected, or refreshed when that
 * address was connected before.
 *
 * Every redirect back carries the app's base path: behind the hidden prefix,
 * a bare "/integrations" is the hosting site's page, not this app's.
 */
export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const denied = url.searchParams.get("error");
        if (denied) {
          return back(
            denied === "access_denied"
              ? "You declined the Google permissions request."
              : `Google returned an error: ${denied}`,
          );
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return back("Google did not return an authorization code.");

        const expected = await readOauthState();
        if (!expected || expected !== state) {
          return back("That sign-in request did not start in this browser. Please try again.");
        }

        let email: string | undefined;
        try {
          const tokens = await exchangeCode({
            code,
            redirectUri: googleRedirectUri(request),
          });
          email = tokens.email;
          const before = await readGoogleAccounts();
          const known = before.some((a) => email && a.email?.toLowerCase() === email.toLowerCase());
          if (!known && before.length >= MAX_GOOGLE_ACCOUNTS) {
            return back(
              `Up to ${MAX_GOOGLE_ACCOUNTS} Google accounts can be connected. Remove one first.`,
            );
          }
          await saveGoogleAccount({
            refreshToken: tokens.refreshToken,
            email: tokens.email,
            scope: tokens.scope,
            connectedAt: new Date().toISOString(),
          });
        } catch (error) {
          // Never log the code or any token material.
          console.error("[google] token exchange failed", {
            message: error instanceof Error ? error.message : "unknown",
          });
          return back(error instanceof Error ? error.message : "Google sign-in failed.");
        }

        const done = new URLSearchParams({ google: "connected", ...(email ? { email } : {}) });
        return new Response(null, {
          status: 302,
          headers: { location: withBase(`integrations?${done}`), "cache-control": "no-store" },
        });
      },
    },
  },
});

function back(message: string): Response {
  const target = withBase(`integrations?google=error&message=${encodeURIComponent(message)}`);
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "no-store" },
  });
}

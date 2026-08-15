import { createFileRoute } from "@tanstack/react-router";

import { exchangeCode } from "@/server/providers/google";
import { readGoogleSession, writeGoogleSession } from "@/server/google-session";

import { googleRedirectUri } from "./api.google.auth";

/**
 * Completes the Google consent round trip.
 *
 * The `state` value is compared against the one stored in the sealed session,
 * so a consent response that did not originate from this browser is rejected.
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

        const session = await readGoogleSession();
        if (!session.oauthState || session.oauthState !== state) {
          return back("That sign-in request did not start in this browser. Please try again.");
        }

        try {
          const tokens = await exchangeCode({
            code,
            redirectUri: googleRedirectUri(request),
          });
          await writeGoogleSession({
            refreshToken: tokens.refreshToken,
            email: tokens.email,
            scope: tokens.scope,
            connectedAt: new Date().toISOString(),
            oauthState: undefined,
          });
        } catch (error) {
          // Never log the code or any token material.
          console.error("[google] token exchange failed", {
            message: error instanceof Error ? error.message : "unknown",
          });
          return back(error instanceof Error ? error.message : "Google sign-in failed.");
        }

        return new Response(null, {
          status: 302,
          headers: { location: "/integrations?google=connected", "cache-control": "no-store" },
        });
      },
    },
  },
});

function back(message: string): Response {
  const target = `/integrations?google=error&message=${encodeURIComponent(message)}`;
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "no-store" },
  });
}

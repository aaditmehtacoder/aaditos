import { createFileRoute } from "@tanstack/react-router";

import { newId } from "@/lib/core/ids";
import { buildConsentUrl, googleConfigured } from "@/server/providers/google";
import { encryptionReady, writeGoogleSession } from "@/server/google-session";

/**
 * The redirect URI must match the one registered in Google Cloud exactly.
 *
 * Behind a proxy (Vercel) the forwarded headers are authoritative. Otherwise
 * the request's own protocol is used — guessing from the hostname got
 * `http://127.0.0.1:4173` wrong by upgrading it to https.
 */
export function googleRedirectUri(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto ?? url.protocol.replace(":", "");
  return `${protocol}://${host}/api/google/callback`;
}

/** Starts the Google consent flow. */
export const Route = createFileRoute("/api/google/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!googleConfigured()) {
          return problem(
            "Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.",
          );
        }
        if (!encryptionReady()) {
          return problem(
            "TOKEN_ENCRYPTION_KEY must be set (32+ characters) before AaditOS will store a Google refresh token.",
          );
        }

        const state = newId();
        await writeGoogleSession({ oauthState: state });

        return new Response(null, {
          status: 302,
          headers: {
            location: buildConsentUrl({ redirectUri: googleRedirectUri(request), state }),
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});

function problem(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Google setup</title>
     <body style="font:15px/1.5 system-ui;padding:2rem;max-width:34rem">
       <h1 style="font-size:1.05rem">Google is not ready yet</h1>
       <p style="color:#555">${escapeHtml(message)}</p>
       <p><a href="/integrations">Back to Integrations</a></p>
     </body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

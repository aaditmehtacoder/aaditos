import { createFileRoute } from "@tanstack/react-router";

import { providerCapabilities } from "@/server/env";

/**
 * Which providers are configured on the server.
 *
 * Booleans only — no key, token or secret is ever serialized here. The
 * Integrations page uses this to show the truth instead of a hopeful default.
 */
export const Route = createFileRoute("/api/config")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(providerCapabilities()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "private, max-age=30",
          },
        }),
    },
  },
});

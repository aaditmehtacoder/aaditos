import { createFileRoute } from "@tanstack/react-router";
import { controlPlayback } from "@/server/providers/spotify";
import { SpotifyControlSchema } from "@/server/schemas";

/**
 * Playback control. Requires Spotify Premium — the adapter reports that
 * limitation instead of pretending the request worked.
 */
export const Route = createFileRoute("/api/spotify/control")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, message: "Invalid JSON body" }, 400);
        }
        const parsed = SpotifyControlSchema.safeParse(body);
        if (!parsed.success) {
          return json({ ok: false, message: "Unknown playback action" }, 422);
        }
        const result = await controlPlayback(parsed.data.action);
        return json(result, result.ok ? 200 : 409);
      },
    },
  },
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

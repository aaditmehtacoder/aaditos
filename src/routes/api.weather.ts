import { createFileRoute } from "@tanstack/react-router";

import { fetchWeather } from "@/server/providers/weather";

/**
 * Santa Clara weather from Open-Meteo. No API key, no personal data, so this
 * works in every environment including demo mode.
 */
export const Route = createFileRoute("/api/weather")({
  server: {
    handlers: {
      GET: async () => {
        const result = await fetchWeather();
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 502,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=600, stale-while-revalidate=1800",
          },
        });
      },
    },
  },
});

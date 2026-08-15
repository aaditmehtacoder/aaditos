/** Open-Meteo adapter. Free, keyless, and rate-friendly. */

const SANTA_CLARA = { latitude: 37.3541, longitude: -121.9552 };

import type { WeatherResult } from "@/lib/integrations/contracts";

export type { WeatherResult };

/** WMO weather interpretation codes, condensed to the labels we display. */
const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Severe thunderstorm",
};

let cache: { at: number; value: WeatherResult } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function fetchWeather(): Promise<WeatherResult> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(SANTA_CLARA.latitude));
  url.searchParams.set("longitude", String(SANTA_CLARA.longitude));
  // `is_day` is what lets a clear sky draw a moon at 9pm instead of a sun.
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "America/Los_Angeles");
  url.searchParams.set("forecast_days", "1");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) {
      return { ok: false, error: `Weather service returned ${response.status}` };
    }
    const data = (await response.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    };
    const code = data.current?.weather_code ?? 0;
    const value: WeatherResult = {
      ok: true,
      tempF: Math.round(data.current?.temperature_2m ?? 0),
      highF: Math.round(data.daily?.temperature_2m_max?.[0] ?? 0),
      lowF: Math.round(data.daily?.temperature_2m_min?.[0] ?? 0),
      condition: WMO[code] ?? "—",
      code,
      // Open-Meteo sends 1 for day and 0 for night; default to day so a missing
      // field never renders a moon at noon.
      isDay: data.current?.is_day !== 0,
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? `Weather unavailable: ${error.message}` : "Weather unavailable",
    };
  }
}

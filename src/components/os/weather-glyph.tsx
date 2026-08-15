/**
 * The weather icon.
 *
 * Open-Meteo reports conditions as WMO interpretation codes, which are grouped
 * in tens: 5x is drizzle, 6x rain, 7x snow, 8x showers, 9x thunderstorm. Codes
 * that never appear in a Santa Clara forecast (ice pellets, blowing snow) are
 * still mapped, because falling through to a sun on a code we forgot is exactly
 * the failure worth avoiding — a wrong icon is read as fact.
 *
 * Only codes 0–2 are clear enough for the sky to matter, so those are the only
 * ones that vary by day and night.
 */

import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";

export function weatherIcon(code: number | undefined, isDay = true): LucideIcon {
  if (code === undefined) return Cloud;

  switch (code) {
    case 0:
      return isDay ? Sun : Moon;
    case 1:
      return isDay ? Sun : Moon;
    case 2:
      return isDay ? CloudSun : CloudMoon;
    case 3:
      return Cloud;
    case 45:
    case 48:
      return CloudFog;
    default:
      break;
  }

  // Everything past here is precipitation, grouped by the tens digit.
  if (code >= 95) return CloudLightning;
  if (code >= 80) return CloudRainWind;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 66 && code <= 67) return CloudRain;
  if (code >= 61 && code <= 65) return CloudRain;
  if (code >= 56 && code <= 57) return CloudDrizzle;
  if (code >= 51 && code <= 55) return CloudDrizzle;
  return Cloud;
}

export function WeatherGlyph({
  code,
  isDay,
  className,
}: {
  code: number | undefined;
  isDay?: boolean | undefined;
  className?: string | undefined;
}) {
  const Icon = weatherIcon(code, isDay ?? true);
  return <Icon className={className} aria-hidden />;
}

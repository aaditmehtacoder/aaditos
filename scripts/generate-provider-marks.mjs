/**
 * Generates `src/components/os/provider-marks.ts` from the `simple-icons`
 * package.
 *
 * Why generate instead of importing at runtime: `simple-icons` ships 3,400+
 * icons. Importing it from app code would either bloat the client bundle or
 * rely on tree-shaking that is easy to break. Extracting the dozen marks we
 * actually use into a plain data module keeps the browser payload to a few
 * hundred bytes and keeps `simple-icons` a devDependency.
 *
 * Re-run with `bun run marks` after upgrading simple-icons.
 *
 * Two brands are absent from simple-icons and are therefore NOT generated
 * here — they live hand-drawn in `provider-logo.tsx` with a note explaining
 * why: OpenAI and LinkedIn. Both had their marks removed from the project.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import * as si from "simple-icons";

/** provider id in the AaditOS registry -> simple-icons export name. */
const MAP = {
  github: "siGithub",
  vercel: "siVercel",
  supabase: "siSupabase",
  google: "siGoogle",
  google_calendar: "siGooglecalendar",
  google_classroom: "siGoogleclassroom",
  google_drive: "siGoogledrive",
  gmail: "siGmail",
  spotify: "siSpotify",
  discord: "siDiscord",
};

/**
 * Relative luminance of a hex colour, 0 (black) to 1 (white).
 * Near-black brand colours are unreadable on a dark background, so those marks
 * render with `currentColor` instead of their brand hex.
 */
function luminance(hex) {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const DARK_THRESHOLD = 0.06;

// The package does not expose ./package.json through its exports map, so read
// it off disk rather than resolving it.
const VERSION = JSON.parse(
  readFileSync(resolve(process.cwd(), "node_modules/simple-icons/package.json"), "utf8"),
).version;

const entries = [];
const missing = [];

for (const [id, key] of Object.entries(MAP)) {
  const icon = si[key];
  if (!icon) {
    missing.push(`${id} (${key})`);
    continue;
  }
  const adaptive = luminance(icon.hex) < DARK_THRESHOLD;
  entries.push({ id, title: icon.title, hex: icon.hex, path: icon.path, adaptive });
}

if (missing.length) {
  console.error(`simple-icons is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const body = entries
  .map(
    (e) =>
      `  ${JSON.stringify(e.id)}: {\n` +
      `    title: ${JSON.stringify(e.title)},\n` +
      `    hex: ${JSON.stringify(`#${e.hex}`)},\n` +
      `    adaptive: ${e.adaptive},\n` +
      `    path: ${JSON.stringify(e.path)},\n` +
      `  },`,
  )
  .join("\n");

const out = `/**
 * GENERATED FILE — do not edit by hand.
 * Run \`bun run marks\` to regenerate from the simple-icons package.
 *
 * Source: simple-icons ${VERSION}
 *
 * Every mark is a single 24x24 path, as simple-icons publishes it.
 * \`adaptive\` marks a brand whose own colour is near-black and would vanish on
 * a dark background; those render with currentColor instead of \`hex\`.
 */

export interface ProviderMark {
  title: string;
  /** The brand's official colour, as published by simple-icons. */
  hex: string;
  /** True when the brand colour is too dark to use on a dark background. */
  adaptive: boolean;
  /** 24x24 single-path geometry. */
  path: string;
}

export const PROVIDER_MARKS: Record<string, ProviderMark> = {
${body}
};
`;

const target = resolve(process.cwd(), "src/components/os/provider-marks.ts");
writeFileSync(target, out);
console.log(`wrote ${entries.length} marks to ${target}`);
for (const e of entries) {
  console.log(
    `  ${e.id.padEnd(18)} ${e.title.padEnd(18)} #${e.hex}${e.adaptive ? "  (adaptive)" : ""}`,
  );
}

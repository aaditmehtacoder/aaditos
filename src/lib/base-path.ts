/**
 * Where the app is mounted.
 *
 * Normally "/". When the app is served under a prefix — aaditmehta.dev/<long
 * number>/ — Vite's `base` carries that prefix and every hand-written URL in
 * the app has to carry it too: fetches to `/api/...`, the service worker, the
 * manifest, the icons. The router gets it for free; these helpers are for
 * everything else. `BASE_PATH` always ends with a slash.
 */

export const BASE_PATH: string = import.meta.env.BASE_URL || "/";

/** `withBase("/api/compass")` → "/api/compass" at the root, "/123/api/compass" under a prefix. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path.replace(/^\/+/, "")}`;
}

/** The inverse, for a browser href that the router should be given without the prefix. */
export function stripBase(href: string): string {
  if (BASE_PATH === "/") return href;
  const bare = BASE_PATH.replace(/\/$/, "");
  if (href === bare) return "/";
  return href.startsWith(`${bare}/`) ? href.slice(bare.length) : href;
}

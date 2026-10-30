// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * Where the app lives on its host. "/" normally; "/<path>/" when it is
 * mounted under a prefix (aaditmehta.dev/<long number>/). Vite prefixes
 * every asset URL with it and TanStack Start derives the router basepath
 * from it, so one variable moves the whole app. Build-time only.
 */
const basePath = `/${(process.env["APP_BASE_PATH"] ?? "").replace(/^\/+|\/+$/g, "")}/`.replace(
  /\/\/+/g,
  "/",
);

export default defineConfig({
  vite: { base: basePath },
  nitro: {
    // A picture takes the painter 20–60 s on top of the chat model's own
    // time. The host's default would cut the stream before it arrived.
    // Spread through `object`: the wrapper's type lists only a few nitro
    // keys, but it hands the whole object to nitro unchanged.
    ...({ vercel: { functions: { maxDuration: 300 } } } as object),
    // Nitro serves the static output under the same prefix, so a build for
    // aaditmehta.dev/<number>/ puts its assets where the HTML points.
    ...(basePath === "/" ? {} : ({ baseURL: basePath } as object)),
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});

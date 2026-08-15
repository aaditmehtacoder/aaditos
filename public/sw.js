/**
 * AaditOS service worker.
 *
 * Deliberately conservative about what it stores:
 *   - The app shell, icons and build assets are cached so the app opens offline.
 *   - Navigations are network-first with a short timeout, falling back to the
 *     last good copy and then to /offline.html.
 *   - `/api/weather` is the only API response cached (it is public data).
 *   - Every other `/api/*` response is network-only, so nothing personal and no
 *     Compass conversation is ever written to the cache.
 */

const VERSION = "aaditos-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const PAGE_CACHE = `${VERSION}-pages`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

const NAVIGATION_TIMEOUT_MS = 3500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache anything that could contain personal data.
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/weather") {
      event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationStrategy(request));
    return;
  }

  if (
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:js|css|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});

async function navigationStrategy(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await caches.match("/offline.html");
    return (
      fallback ??
      new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return new Response("", { status: 504 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => cached ?? new Response("{}", { headers: { "content-type": "application/json" } }));
  return cached ?? network;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---- notifications -------------------------------------------------------

/**
 * Clicking an alert should return you to the window you already have open, on
 * the page the alert was about. Opening a second copy of the app is the most
 * common way this goes wrong.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/";
  const target = new URL(href, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        // Focus the existing window and steer it, rather than opening a new one.
        return client.focus().then(() => client.navigate?.(target) ?? client);
      }
      return self.clients.openWindow(target);
    }),
  );
});

/**
 * Push arrives with no payload on purpose.
 *
 * Encrypting a push payload requires the full aes128gcm content-encoding dance,
 * and getting it subtly wrong fails silently. Sending an empty "tickle" instead
 * and fetching the actual content here is both simpler and more private: the
 * push service never sees what the notification says.
 */
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let alert = null;
      try {
        const response = await fetch("/api/push/next", { credentials: "include" });
        if (response.ok) alert = await response.json();
      } catch {
        /* offline or signed out — fall through to the generic form */
      }

      // Never show nothing: Chrome penalises a push that resolves without a
      // notification, and can revoke the site's push permission for it.
      const title = alert?.title || "AaditOS";
      const body = alert?.body || "You have something due. Open AaditOS to see it.";
      const href = alert?.href || "/";

      await self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: alert?.key || "aaditos-push",
        data: { href },
      });
    })(),
  );
});

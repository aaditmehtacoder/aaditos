/**
 * Registers the service worker after the page has loaded.
 *
 * Registration is skipped in development so Vite's HMR is never intercepted by
 * a cached shell.
 */

import { useEffect } from "react";
import { BASE_PATH, withBase } from "@/lib/base-path";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (import.meta.env.DEV) return;

    const register = () => {
      navigator.serviceWorker
        .register(withBase("sw.js"), { scope: BASE_PATH })
        .catch((error: unknown) => {
          console.warn("[pwa] service worker registration failed", error);
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

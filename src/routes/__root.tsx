import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { AppShell } from "@/components/os/app-shell";
import { AuthGate } from "@/components/os/auth-gate";
import { AutoSync } from "@/components/os/auto-sync";
import { Notifier } from "@/components/os/notifier";
import { ServiceWorkerRegistrar } from "@/components/os/service-worker";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth/context";
import { OSProvider } from "@/lib/store";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

/** Rendered outside the shell — these must never show personal data. */
const PUBLIC_ROUTES = new Set(["/signin", "/auth/callback"]);

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">404</p>
        <h1 className="mt-2 display text-[23px] text-foreground">Page not found</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          That route does not exist in AaditOS.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-[9px] bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
          >
            Go to Today
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-[18px] font-semibold tracking-tight text-foreground">
          This page didn&rsquo;t load
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Something went wrong while rendering. Your data is safe — try again or go back to Today.
        </p>
        <p className="mt-3 break-words rounded-[10px] border border-border bg-card px-3 py-2 text-left text-[12px] text-muted-foreground">
          {error.message}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              void router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-[9px] bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-[9px] border border-border bg-card px-4 py-2 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-accent"
          >
            Go to Today
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "AaditOS" },
      {
        name: "description",
        content: "A private personal operating system for school, projects and focus.",
      },
      { name: "author", content: "Aadit Mehta" },
      // A personal workspace holding real school and project data. It should
      // never be indexed, even though it lives under a public domain.
      { name: "robots", content: "noindex, nofollow" },
      // The brand indigo, so the mobile browser chrome matches the app rather
      // than sitting one shade off the page background.
      { name: "theme-color", content: "#4F46E5" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "AaditOS" },
      { name: "application-name", content: "AaditOS" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "AaditOS" },
      { property: "og:title", content: "AaditOS" },
      {
        property: "og:description",
        content:
          "A private personal operating system for school, projects and focus, with Compass reading the real data behind it.",
      },
      { property: "og:image", content: "/icons/icon-512.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "AaditOS" },
      {
        name: "twitter:description",
        content: "A private personal operating system for school, projects and focus.",
      },
      { name: "twitter:image", content: "/icons/icon-512.png" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        // Inter for the interface, Fraunces for display headings — the same
        // pairing aaditmehta.dev and pick44.com use. Fraunces is requested at
        // its light optical-display axis (SOFT 0, WONK 0, opsz 24, wght 300),
        // which is the weight both sites set their headlines in.
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,300;9..144,400&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Applies the stored theme before first paint so there is no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('aaditos:theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublic = PUBLIC_ROUTES.has(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {isPublic ? (
          <Outlet />
        ) : (
          <AuthGate>
            <OSProvider>
              <AppShell>
                <Outlet />
              </AppShell>
              <Notifier />
              <AutoSync />
            </OSProvider>
          </AuthGate>
        )}
        <Toaster position="bottom-right" />
        <ServiceWorkerRegistrar />
      </AuthProvider>
    </QueryClientProvider>
  );
}

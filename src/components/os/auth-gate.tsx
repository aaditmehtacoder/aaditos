/**
 * Route guard.
 *
 * Renders nothing that belongs to a person until the session is confirmed.
 * While restoring, it shows a neutral shell skeleton; if there is no session it
 * redirects to `/signin`, remembering where the user was heading.
 */

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/lib/auth/context";
import { LAST_ROUTE_KEY } from "@/lib/auth/config";

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh w-full bg-background" aria-hidden>
      <div className="hidden h-dvh w-[216px] shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <div className="px-4 py-3.5">
          <div className="h-6 w-24 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="space-y-1.5 px-3 pt-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded-[9px] bg-muted" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[49px] border-b border-border" />
        <div className="grid flex-1 grid-cols-1 gap-4 p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_300px]">
          <div className="h-64 animate-pulse rounded-[14px] bg-muted" />
          <div className="h-64 animate-pulse rounded-[14px] bg-muted" />
          <div className="hidden h-64 animate-pulse rounded-[14px] bg-muted xl:block" />
        </div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });

  useEffect(() => {
    if (status !== "signed-out") return;
    try {
      window.sessionStorage.setItem(LAST_ROUTE_KEY, location.href);
    } catch {
      /* storage unavailable */
    }
    void navigate({ to: "/signin", replace: true });
  }, [status, navigate, location.href]);

  if (status === "loading") {
    return (
      <>
        <span className="sr-only" role="status" aria-live="polite">
          Restoring your session
        </span>
        <ShellSkeleton />
      </>
    );
  }

  if (status === "signed-out") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <p className="text-[13px] text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  return <>{children}</>;
}

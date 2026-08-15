import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/auth/client";
import { LAST_ROUTE_KEY } from "@/lib/auth/config";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in · AaditOS" }] }),
  component: AuthCallbackPage,
});

/**
 * Completes the Google OAuth round trip.
 *
 * Supabase returns either `?code=` (PKCE) or a `#access_token=` fragment.
 *
 * `createBrowserClient` runs with `detectSessionInUrl` enabled, so the client
 * exchanges the code itself the moment it initializes on this route. That
 * consumes the one-time PKCE verifier. Calling `exchangeCodeForSession` here as
 * well therefore loses a race it can never win: the second exchange finds no
 * verifier and reports "PKCE code verifier not found in storage", even though
 * the session was created successfully a millisecond earlier.
 *
 * So the session — not the exchange — is the source of truth. We wait for one
 * to appear, only attempt a manual exchange if the automatic one did not
 * produce it, and never surface an exchange error while a valid session exists.
 */
const SESSION_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 150;

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function complete() {
      const supabase = getSupabase();
      if (!supabase) {
        setError("Supabase is not configured in this environment.");
        return;
      }

      const url = new URL(window.location.href);
      const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (oauthError) {
        if (!cancelled) setError(oauthError);
        return;
      }

      const hasSession = async () => (await supabase.auth.getSession()).data.session != null;

      // Give the client's own exchange a bounded window to land.
      const deadline = Date.now() + SESSION_WAIT_MS;
      let signedIn = await hasSession();
      while (!signedIn && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelled) return;
        signedIn = await hasSession();
      }

      // Only exchange by hand when the automatic path produced nothing. An
      // error here is not fatal on its own: re-check for a session first.
      if (!signedIn) {
        const code = url.searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (cancelled) return;
          signedIn = await hasSession();
          if (!signedIn && exchangeError) {
            setError(exchangeError.message);
            return;
          }
        }
      }

      if (cancelled) return;
      if (!signedIn) {
        setError("Sign-in did not complete. Please try again.");
        return;
      }

      let target = "/";
      try {
        const stored = window.sessionStorage.getItem(LAST_ROUTE_KEY);
        if (stored && !stored.startsWith("/signin")) target = stored;
        window.sessionStorage.removeItem(LAST_ROUTE_KEY);
      } catch {
        /* storage unavailable */
      }
      void navigate({ to: target, replace: true });
    }

    void complete();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <div
              role="alert"
              className="mx-auto mb-3 grid size-9 place-items-center rounded-full border border-urgent/30 bg-urgent-soft text-urgent"
            >
              <AlertTriangle className="size-4" aria-hidden />
            </div>
            <h1 className="text-[16px] font-semibold tracking-tight">Sign-in failed</h1>
            <p className="mt-2 text-[12.5px] text-muted-foreground">{error}</p>
            <Button
              className="mt-5 h-9 text-[13px]"
              onClick={() => void navigate({ to: "/signin", replace: true })}
            >
              Back to sign in
            </Button>
          </>
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Completing sign-in…
          </p>
        )}
      </div>
    </div>
  );
}

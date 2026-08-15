import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, KeyRound, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LAST_ROUTE_KEY } from "@/lib/auth/config";
import { useAuth } from "@/lib/auth/context";

interface PasscodeAccount {
  id: string;
  label: string;
  email: string;
}

export const Route = createFileRoute("/signin")({
  head: () => ({
    meta: [
      { title: "Sign in · AaditOS" },
      { name: "description", content: "Sign in to your private personal operating system." },
    ],
  }),
  component: SignInPage,
});

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.86 8.88 4.75 12 4.75Z"
      />
    </svg>
  );
}

function SignInPage() {
  const {
    status,
    error,
    signInWithGoogle,
    signInWithPasscode,
    enterDemoMode,
    supabaseConfigured,
    clearError,
  } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Passcode is the primary path: a school-managed Chromebook blocks
  // third-party Google OAuth, so it is the only door that actually opens there.
  const [accounts, setAccounts] = useState<PasscodeAccount[] | null>(null);
  const [account, setAccount] = useState<string>("");
  const [passcode, setPasscode] = useState("");
  const [passcodeBusy, setPasscodeBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch("/api/auth/passcode")
      .then((r) => r.json() as Promise<{ configured: boolean; accounts: PasscodeAccount[] }>)
      .then((data) => {
        if (!live) return;
        const list = data.configured ? data.accounts : [];
        setAccounts(list);
        setAccount((current) => current || list[0]?.id || "");
      })
      .catch(() => live && setAccounts([]));
    return () => {
      live = false;
    };
  }, []);

  async function submitPasscode(event: React.FormEvent) {
    event.preventDefault();
    if (!account || !passcode.trim() || passcodeBusy) return;
    setPasscodeBusy(true);
    const ok = await signInWithPasscode(account, passcode);
    setPasscodeBusy(false);
    // Only clear the field on failure; on success the route is about to change.
    if (!ok) setPasscode("");
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    let target = "/";
    try {
      const stored = window.sessionStorage.getItem(LAST_ROUTE_KEY);
      if (stored && !stored.startsWith("/signin")) target = stored;
      window.sessionStorage.removeItem(LAST_ROUTE_KEY);
    } catch {
      /* storage unavailable */
    }
    void navigate({ to: target, replace: true });
  }, [status, navigate]);

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px]">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-[8px] bg-primary text-[12px] font-bold text-primary-foreground"
            >
              A
            </span>
            <span className="text-[15px] font-semibold tracking-tight">AaditOS</span>
          </div>

          <h1 className="mt-8 display text-[25px]">Sign in</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            A private workspace. Pick an account and enter your passcode — or continue with Google
            on a device that allows it.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-[10px] border border-urgent/30 bg-urgent-soft px-3 py-2.5 text-[12.5px] text-urgent"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                {error}
                <button
                  type="button"
                  onClick={clearError}
                  className="ml-2 underline underline-offset-2"
                >
                  Dismiss
                </button>
              </span>
            </div>
          ) : null}

          {accounts && accounts.length > 0 ? (
            <form onSubmit={submitPasscode} className="mt-6">
              <fieldset disabled={passcodeBusy} className="space-y-2.5">
                <legend className="sr-only">Sign in with a passcode</legend>

                <div
                  role="radiogroup"
                  aria-label="Account"
                  className="flex gap-1 rounded-[10px] bg-secondary p-1"
                >
                  {accounts.map((option) => {
                    const selected = option.id === account;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        title={option.email}
                        onClick={() => setAccount(option.id)}
                        className={
                          selected
                            ? "min-w-0 flex-1 truncate rounded-[7px] bg-card px-2 py-1.5 text-[12px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                            : "min-w-0 flex-1 truncate rounded-[7px] px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <Input
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Passcode"
                  autoComplete="current-password"
                  autoFocus
                  aria-label="Passcode"
                  className="h-10 text-[13px]"
                />

                <Button
                  type="submit"
                  className="h-10 w-full justify-center gap-1.5 text-[13px]"
                  disabled={!passcode.trim() || status === "loading"}
                >
                  {passcodeBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <KeyRound className="size-3.5" aria-hidden />
                  )}
                  Sign in
                </Button>
                <p className="text-[12px] text-muted-foreground">
                  Works on a school Chromebook, where Google sign-in is blocked.
                </p>
              </fieldset>
            </form>
          ) : null}

          <div className="mt-6 space-y-2.5">
            {accounts && accounts.length > 0 ? (
              <div className="flex items-center gap-3 pb-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  or
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}

            <Button
              className="h-10 w-full justify-center gap-2 text-[13px]"
              variant="outline"
              disabled={!supabaseConfigured || busy || status === "loading"}
              onClick={() => {
                setBusy(true);
                void signInWithGoogle().finally(() => setBusy(false));
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GoogleMark />}
              Continue with Google
            </Button>

            {!supabaseConfigured ? (
              <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
                <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>
                  Google sign-in needs a Supabase project. Set{" "}
                  <code className="rounded bg-secondary px-1 text-[11px]">VITE_SUPABASE_URL</code>{" "}
                  and{" "}
                  <code className="rounded bg-secondary px-1 text-[11px]">
                    VITE_SUPABASE_ANON_KEY
                  </code>{" "}
                  and apply the migrations — the README has the exact steps.
                </span>
              </p>
            ) : null}

            {/* Demo mode is a third-tier action: available, never competing
                with the two real ways in. */}
            <div className="mt-4 border-t border-border pt-4">
              <Button
                variant="ghost"
                className="h-9 w-full justify-center gap-1.5 text-[13px] text-muted-foreground"
                onClick={enterDemoMode}
                disabled={status === "loading"}
              >
                Explore demo mode
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Realistic sample data stored only in this browser. No provider is connected and
                nothing is sent anywhere.
              </p>
            </div>
          </div>
        </div>
      </main>

      <aside className="hidden border-l border-border bg-card px-10 py-12 lg:flex lg:flex-col lg:justify-center">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          What AaditOS answers
        </p>
        <ol className="mt-4 space-y-4">
          {[
            {
              q: "What is happening today?",
              a: "School status, the next class, the day's timeline and the current track — merged from every connected source.",
            },
            {
              q: "What is most important right now?",
              a: "One ranked Next Move computed from due date, priority, estimated time and the window you actually have.",
            },
            {
              q: "What should I do next?",
              a: "A time-blocked plan from Compass that only ever proposes — you confirm before anything is saved.",
            },
          ].map((item, i) => (
            <li key={item.q} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border text-[11px] tabular-nums text-muted-foreground"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">{item.q}</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{item.a}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 max-w-sm text-[12px] text-muted-foreground">
          Built for a ninth-grade full-stack developer at Wilcox High School — school, Venu AI,
          Pick44, Origami Prep, OpenRubric and hackathons in one place.
        </p>
      </aside>
    </div>
  );
}

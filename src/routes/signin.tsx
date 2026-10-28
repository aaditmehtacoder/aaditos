import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { LogoMark } from "@/components/os/logo";
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
      { name: "description", content: "Sign in to your private planner." },
    ],
  }),
  component: SignInPage,
});

/**
 * One password. That is the whole sign-in.
 *
 * The page used to offer an account picker, a passcode, a Google button and a
 * demo button, with a paragraph explaining each. For an app with one user,
 * every one of those was a decision before the only field that matters.
 *
 * Google sign-in is still here as the fallback for a deployment where the
 * password has not been configured. There is no demo mode: the only way in is
 * a real session.
 */
function SignInPage() {
  const { status, error, signInWithGoogle, signInWithPasscode, supabaseConfigured, clearError } =
    useAuth();
  const navigate = useNavigate();

  // null until the server has answered, so the page never flashes the wrong door.
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<PasscodeAccount[]>([]);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch("/api/auth/passcode")
      .then((r) => r.json() as Promise<{ configured: boolean; accounts: PasscodeAccount[] }>)
      .then((data) => {
        if (!live) return;
        setConfigured(data.configured);
        setAccounts(data.accounts ?? []);
        setAccount((current) => current || data.accounts?.[0]?.id || "");
      })
      .catch(() => live && setConfigured(false));
    return () => {
      live = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    const ok = await signInWithPasscode(password, accounts.length > 1 ? account : undefined);
    setBusy(false);
    if (!ok) setPassword("");
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

  const showPassword = configured !== false;
  const showGoogle = configured === false && supabaseConfigured;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[320px]">
        <div className="flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">AaditOS</span>
        </div>

        <h1 className="mt-8 display text-[25px]">Sign in</h1>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-[10px] border border-urgent/30 bg-urgent-soft px-3 py-2.5 text-[12.5px] text-urgent"
          >
            {error}
            <button
              type="button"
              onClick={clearError}
              className="ml-2 underline underline-offset-2"
            >
              Dismiss
            </button>
          </p>
        ) : null}

        {showPassword ? (
          <form onSubmit={submit} className="mt-5">
            <fieldset disabled={busy || configured === null} className="space-y-2.5">
              <legend className="sr-only">Sign in with your password</legend>

              {accounts.length > 1 ? (
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
              ) : null}

              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                autoFocus
                aria-label="Password"
                className="h-11 text-[14px]"
              />

              <Button
                type="submit"
                className="h-11 w-full justify-center gap-1.5 text-[13.5px]"
                disabled={!password.trim() || status === "loading"}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Sign in
              </Button>
            </fieldset>
          </form>
        ) : null}

        {showGoogle ? (
          <div className="mt-5 space-y-2">
            <Button
              className="h-11 w-full justify-center gap-2 text-[13.5px]"
              variant="outline"
              disabled={busy || status === "loading"}
              onClick={() => {
                setBusy(true);
                void signInWithGoogle().finally(() => setBusy(false));
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GoogleMark />}
              Continue with Google
            </Button>
            <p className="text-[12px] text-muted-foreground">
              Password sign-in is not set up on this server yet.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

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

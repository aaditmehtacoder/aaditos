/**
 * Authentication state.
 *
 * One way in: a Supabase session, reached through the password field or
 * Google. There is no demo or sample mode; nothing renders personal data
 * until `status === "authenticated"`, and the session is restored before the
 * first paint of any protected route.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Profile } from "@/lib/core/types";
import { APP_TZ } from "@/lib/core/time";

import { authCallbackUrl, getSupabase } from "./client";
import { supabaseConfigured } from "./config";

export type SessionMode = "google";

export type AuthStatus = "loading" | "authenticated" | "signed-out";

export interface AuthSession {
  mode: SessionMode;
  profile: Profile;
  /** Present only for real Supabase sessions; used to authorize server calls. */
  accessToken?: string | undefined;
}

interface AuthContextValue {
  status: AuthStatus;
  session: AuthSession | null;
  error: string | null;
  supabaseConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  /** Password sign-in — one field. `account` only matters if there is more than one. */
  signInWithPasscode: (passcode: string, account?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SupabaseUserLike {
  id: string;
  email?: string | undefined;
  user_metadata?: { full_name?: string; name?: string; avatar_url?: string } | undefined;
}

function profileFromSupabase(user: SupabaseUserLike): Profile {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? "",
    name: meta.full_name ?? meta.name ?? user.email?.split("@")[0] ?? "Aadit Mehta",
    avatarUrl: meta.avatar_url,
    school: "Wilcox High School",
    grade: "Grade 9",
    city: "Santa Clara, CA",
    timezone: APP_TZ,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    async function restore() {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (data.session?.user) {
            if (!mounted.current) return;
            setSession({
              mode: "google",
              profile: profileFromSupabase(data.session.user as SupabaseUserLike),
              accessToken: data.session.access_token,
            });
            setStatus("authenticated");
          } else {
            setStatus("signed-out");
          }

          const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!mounted.current) return;
            if (nextSession?.user) {
              setSession({
                mode: "google",
                profile: profileFromSupabase(nextSession.user as SupabaseUserLike),
                accessToken: nextSession.access_token,
              });
              setStatus("authenticated");
            } else {
              setSession(null);
              setStatus("signed-out");
            }
          });
          unsubscribe = () => sub.subscription.unsubscribe();
          return;
        } catch (err) {
          if (!mounted.current) return;
          setError(err instanceof Error ? err.message : "Could not restore your session.");
        }
      }

      if (!mounted.current) return;
      setStatus("signed-out");
    }

    void restore();
    return () => unsubscribe?.();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setError(
        "Google sign-in needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. See the README for setup.",
      );
      return;
    }
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authCallbackUrl(),
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (oauthError) setError(oauthError.message);
  }, []);

  /**
   * Trades the passcode for a session on the server, then installs that session
   * in the browser client so `onAuthStateChange` picks it up like any other
   * sign-in. The real Supabase password stays on the server.
   */
  const signInWithPasscode = useCallback(async (passcode: string, account?: string) => {
    const supabase = getSupabase();
    if (!supabase) {
      setError("Sign-in needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return false;
    }
    setError(null);

    let payload: { ok?: boolean; accessToken?: string; refreshToken?: string; message?: string };
    try {
      const response = await fetch("/api/auth/passcode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(account ? { account, passcode } : { passcode }),
      });
      payload = (await response.json()) as typeof payload;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }

    if (!payload.ok || !payload.accessToken || !payload.refreshToken) {
      setError(payload.message ?? "Sign-in failed.");
      return false;
    }

    const { error: setErr } = await supabase.auth.setSession({
      access_token: payload.accessToken,
      refresh_token: payload.refreshToken,
    });
    if (setErr) {
      setError(setErr.message);
      return false;
    }
    return true;
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) setError(signOutError.message);
    }
    setSession(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      error,
      supabaseConfigured,
      signInWithGoogle,
      signInWithPasscode,
      signOut,
      clearError: () => setError(null),
    }),
    [status, session, error, signInWithGoogle, signInWithPasscode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/**
 * The row-ownership key. For Supabase sessions this is the Supabase user id,
 * which is exactly what the RLS policies compare against `auth.uid()`.
 */
export function userIdForSession(session: AuthSession): string {
  return session.profile.id;
}

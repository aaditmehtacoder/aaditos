/**
 * Browser Supabase client.
 *
 * Created lazily so the app boots (and demo mode works) when Supabase is not
 * configured. Sessions are stored in cookies via `@supabase/ssr` so the same
 * session is readable during SSR when a server-side session check is added.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "./config";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured || typeof window === "undefined") return null;
  if (!client) {
    client = createBrowserClient(supabaseUrl!, supabaseAnonKey!);
  }
  return client;
}

export function authCallbackUrl(): string {
  if (typeof window === "undefined") return "/auth/callback";
  return `${window.location.origin}/auth/callback`;
}

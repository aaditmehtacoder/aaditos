/**
 * Public auth configuration.
 *
 * Only the Supabase project URL and the anon key live here — both are designed
 * to be public and are useless without Row Level Security policies, which the
 * migrations in `supabase/migrations` install.
 */

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

export const supabaseUrl = url?.trim() || undefined;
export const supabaseAnonKey = anonKey?.trim() || undefined;
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const DEMO_SESSION_KEY = "aaditos:session-mode";
export const LAST_ROUTE_KEY = "aaditos:last-route";

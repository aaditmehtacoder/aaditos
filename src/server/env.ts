/**
 * Server-only environment access.
 *
 * Nothing in this module may be imported from client code. Values are read
 * lazily so a missing variable produces a clean "needs configuration" state
 * instead of a crash at import time, and only booleans ever leave the server.
 */

import type { ProviderCapabilities } from "@/lib/integrations/contracts";

export type { ProviderCapabilities };

function read(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const serverEnv = {
  get openaiApiKey(): string | undefined {
    return read("OPENAI_API_KEY");
  },
  get openaiModel(): string {
    // luna is the cost tier of the 5.6 family: 10x cheaper per token than
    // terra and 25x cheaper than sol. It handles Compass's workload (tool calls
    // over a snapshot, short factual answers) with no measured loss in
    // correctness, so it is the safe default if OPENAI_MODEL is ever unset.
    return read("OPENAI_MODEL") ?? "gpt-5.6-luna";
  },
  get openaiMaxOutputTokens(): number {
    const raw = read("OPENAI_MAX_OUTPUT_TOKENS");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1800;
  },
  get openaiDailyRequestCap(): number {
    const raw = read("OPENAI_DAILY_REQUEST_CAP");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
  },
  get safetyIdentifierSalt(): string {
    return read("SAFETY_IDENTIFIER_SALT") ?? "aaditos-local-salt";
  },
  get githubToken(): string | undefined {
    return read("GITHUB_TOKEN");
  },
  get githubOwner(): string | undefined {
    return read("GITHUB_OWNER");
  },
  get vercelToken(): string | undefined {
    return read("VERCEL_TOKEN");
  },
  get vercelTeamId(): string | undefined {
    return read("VERCEL_TEAM_ID");
  },
  get spotifyClientId(): string | undefined {
    return read("SPOTIFY_CLIENT_ID");
  },
  get spotifyClientSecret(): string | undefined {
    return read("SPOTIFY_CLIENT_SECRET");
  },
  get spotifyRefreshToken(): string | undefined {
    return read("SPOTIFY_REFRESH_TOKEN");
  },
  get googleClientId(): string | undefined {
    return read("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret(): string | undefined {
    return read("GOOGLE_CLIENT_SECRET");
  },
  get aeriesBaseUrl(): string | undefined {
    return read("AERIES_BASE_URL");
  },
  get aeriesCert(): string | undefined {
    return read("AERIES_CERT");
  },
  get aeriesSchoolCode(): string | undefined {
    return read("AERIES_SCHOOL_CODE");
  },
  get aeriesStudentId(): string | undefined {
    return read("AERIES_STUDENT_ID");
  },
  get aeriesPathClasses(): string | undefined {
    return read("AERIES_PATH_CLASSES");
  },
  get aeriesPathGradebooks(): string | undefined {
    return read("AERIES_PATH_GRADEBOOKS");
  },
  get aeriesPathGrades(): string | undefined {
    return read("AERIES_PATH_GRADES");
  },
  get cronSecret(): string | undefined {
    return read("CRON_SECRET");
  },
  get tokenEncryptionKey(): string | undefined {
    return read("TOKEN_ENCRYPTION_KEY");
  },
  get supabaseUrl(): string | undefined {
    return read("SUPABASE_URL") ?? read("VITE_SUPABASE_URL");
  },
  get supabaseServiceRoleKey(): string | undefined {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
  get supabaseAnonKey(): string | undefined {
    return read("SUPABASE_ANON_KEY") ?? read("VITE_SUPABASE_ANON_KEY");
  },
  /** The short passcode typed on the sign-in page. Never a Supabase password. */
  get appPasscode(): string | undefined {
    return read("APP_PASSCODE");
  },
  /** Derives each account's real Supabase password. Rotating this locks everyone out until reprovisioned. */
  get accountPasswordSecret(): string | undefined {
    return read("ACCOUNT_PASSWORD_SECRET");
  },
  /** Public by design — it is baked into every push subscription in the browser. */
  get vapidPublicKey(): string | undefined {
    return read("VAPID_PUBLIC_KEY") ?? read("VITE_VAPID_PUBLIC_KEY");
  },
  /** Secret. Signs the VAPID JWT that proves a push came from this server. */
  get vapidPrivateKey(): string | undefined {
    return read("VAPID_PRIVATE_KEY");
  },
  /** Contact address push services use to reach the operator. */
  get vapidSubject(): string | undefined {
    return read("VAPID_SUBJECT");
  },
};

export function providerCapabilities(): ProviderCapabilities {
  return {
    openai: Boolean(serverEnv.openaiApiKey),
    openaiModel: serverEnv.openaiModel,
    github: Boolean(serverEnv.githubToken),
    vercel: Boolean(serverEnv.vercelToken),
    spotify: Boolean(
      serverEnv.spotifyClientId && serverEnv.spotifyClientSecret && serverEnv.spotifyRefreshToken,
    ),
    google: Boolean(serverEnv.googleClientId && serverEnv.googleClientSecret),
    supabase: Boolean(serverEnv.supabaseUrl && serverEnv.supabaseAnonKey),
    cron: Boolean(serverEnv.cronSecret),
    aeries: Boolean(serverEnv.aeriesBaseUrl && serverEnv.aeriesCert && serverEnv.aeriesStudentId),
    wilcox: true,
    weather: true,
  };
}

/**
 * AES-GCM encryption for provider refresh tokens. Tokens are never written to
 * storage in plaintext; without `TOKEN_ENCRYPTION_KEY` the caller must refuse
 * to persist them at all.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const [ivPart, dataPart] = payload.split(".");
  if (!ivPart || !dataPart) throw new Error("Malformed encrypted payload");
  const key = await importKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivPart) },
    key,
    fromBase64(dataPart),
  );
  return new TextDecoder().decode(plain);
}

async function importKey(): Promise<CryptoKey> {
  const raw = serverEnv.tokenEncryptionKey;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set — refusing to handle provider tokens without encryption.",
    );
  }
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

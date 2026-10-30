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

/** Comma- or newline-separated list, trimmed, empties dropped, order kept. */
function readList(name: string): string[] {
  const raw = read(name);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,\n]/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

export const serverEnv = {
  /**
   * The address people actually use, when it is not the host this runs on:
   * `https://aaditmehta.dev` while the app is proxied from there. Used for
   * OAuth redirect URIs, which must match what the browser will come back to.
   */
  get publicOrigin(): string | undefined {
    return read("APP_PUBLIC_ORIGIN")?.replace(/\/+$/, "");
  },
  /**
   * Shared with the proxy in front of the app. When set, a request without
   * it in `x-aaditos-gate` gets a 404 — the deployment itself answers no one.
   */
  get gateSecret(): string | undefined {
    return read("AADITOS_GATE_SECRET");
  },
  get openaiApiKey(): string | undefined {
    return read("OPENAI_API_KEY");
  },
  /**
   * Every key the assistant may use, primary first.
   *
   * `OPENAI_API_KEY` is the one that normally answers. `OPENAI_API_KEY_FALLBACK`
   * (or a comma-separated `OPENAI_API_KEYS`) is a spare on a different account
   * or project: when the primary hits a hard quota or rate limit the request
   * moves to the next key instead of failing. "Never runs out" is only true
   * with two keys, which is why the second one exists.
   */
  get openaiApiKeys(): string[] {
    const keys = [
      read("OPENAI_API_KEY"),
      read("OPENAI_API_KEY_FALLBACK"),
      ...readList("OPENAI_API_KEYS"),
    ];
    return [...new Set(keys.filter((k): k is string => Boolean(k)))];
  },
  /**
   * The models to try, in order. The configured model first; then the
   * fallbacks, which answer when the first is rate limited or unavailable.
   * A cheaper model with headroom beats no answer at all.
   */
  get openaiModels(): string[] {
    const fallbacks = readList("OPENAI_FALLBACK_MODELS");
    const chain = [
      serverEnv.openaiModel,
      ...(fallbacks.length > 0
        ? fallbacks
        : // Measured 2026-10-27: on this key every model has its own daily
          // request budget (50 each) and its own tokens-per-minute ceiling
          // (terra 10k, luna 60k, 5.4-mini 100k). Eight rungs is eight
          // budgets, and a request too big for terra's minute fits luna's.
          [
            "gpt-5.6-luna",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.4-nano",
            "gpt-5.2",
          ]),
    ];
    return [...new Set(chain)];
  },
  /**
   * The image model the assistant draws with, and the ones it falls back to.
   * Image generation runs through the Responses API's `image_generation`
   * tool, so the chat model stays the same; only the painter changes.
   */
  get openaiImageModel(): string {
    return read("OPENAI_IMAGE_MODEL") ?? "gpt-image-2";
  },
  get openaiImageModels(): string[] {
    const fallbacks = readList("OPENAI_IMAGE_FALLBACK_MODELS");
    return [
      ...new Set([
        serverEnv.openaiImageModel,
        ...(fallbacks.length > 0 ? fallbacks : ["gpt-image-1.5", "gpt-image-1-mini"]),
      ]),
    ];
  },
  /**
   * The one model, used for both answering and filing.
   *
   * terra, not the cheaper luna, and both jobs measurably need it:
   *
   * Answering — given a note saying "I always underestimate the outline, last
   * one took 90 minutes", terra reprices a 30-minute estimate at 90 and
   * reorders the evening around it; luna schedules the 30 and mentions the
   * risk afterwards.
   *
   * Filing — on "fin lit packet friday, and Robson wants the thesis arguable",
   * both split it into a task and a note, but luna files the note under
   * Financial Lit because that was the last class mentioned, while terra works
   * out it belongs to English. A note on the wrong class page is worse than no
   * note, because that is where it will be looked for.
   */
  get openaiModel(): string {
    return read("OPENAI_MODEL") ?? "gpt-5.6-terra";
  },

  /**
   * Per-response ceiling. Hard-capped at 16000 regardless of the environment:
   * a typo adding a zero should cost a truncated answer, not a large bill.
   * 1500 was the old default and it cut off anything longer than a page,
   * which for a general assistant is most essays, code and study guides.
   */
  get openaiMaxOutputTokens(): number {
    const raw = read("OPENAI_MAX_OUTPUT_TOKENS");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
    return Math.min(value, 16_000);
  },
  /**
   * Daily AI request ceiling for the signed-in owner. `0` (the default) means
   * none: the owner never runs into a cap. Set a number only if you want a
   * hard spending stop for a runaway bug. Callers without a session — demo
   * mode, or a stranger who finds the endpoint — get `openaiGuestDailyCap`
   * instead, which is what actually protects the key.
   */
  get openaiDailyRequestCap(): number {
    const raw = read("OPENAI_DAILY_REQUEST_CAP");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  },
  /** Daily AI requests for callers with no verified session. Small on purpose. */
  get openaiGuestDailyCap(): number {
    const raw = read("OPENAI_GUEST_DAILY_CAP");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 40;
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
  /** Slack user token (xoxp-…) with `search:read` and `users:read`. */
  get slackUserToken(): string | undefined {
    return read("SLACK_USER_TOKEN") ?? read("SLACK_TOKEN");
  },
  /** Notion internal integration secret (ntn_… / secret_…). */
  get notionToken(): string | undefined {
    return read("NOTION_TOKEN") ?? read("NOTION_API_KEY");
  },
  /** Optional: a Notion database of tasks to pull open rows from. */
  get notionTasksDatabaseId(): string | undefined {
    return read("NOTION_TASKS_DATABASE_ID");
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
  /** The one password typed on the sign-in page. Never a Supabase password. `APP_PASSWORD` is an alias. */
  get appPasscode(): string | undefined {
    return read("APP_PASSCODE") ?? read("APP_PASSWORD");
  },
  /** Derives each account's real Supabase password. Rotating this locks everyone out until reprovisioned. */
  get accountPasswordSecret(): string | undefined {
    return read("ACCOUNT_PASSWORD_SECRET");
  },
};

export function providerCapabilities(): ProviderCapabilities {
  return {
    openai: serverEnv.openaiApiKeys.length > 0,
    openaiModel: serverEnv.openaiModel,
    openaiModels: serverEnv.openaiModels,
    openaiKeys: serverEnv.openaiApiKeys.length,
    openaiImageModel: serverEnv.openaiImageModel,
    google: Boolean(serverEnv.googleClientId && serverEnv.googleClientSecret),
    supabase: Boolean(serverEnv.supabaseUrl && serverEnv.supabaseAnonKey),
    cron: Boolean(serverEnv.cronSecret),
    github: Boolean(serverEnv.githubToken),
    slack: Boolean(serverEnv.slackUserToken),
    notion: Boolean(serverEnv.notionToken),
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

/**
 * Where the Google refresh tokens live.
 *
 * In an httpOnly, sealed cookie — AES-GCM encrypted with `TOKEN_ENCRYPTION_KEY`
 * and never readable from JavaScript. That keeps the only long-lived Google
 * secrets off the client and out of any database, which matters because the
 * default deployment has no database at all.
 *
 * Several accounts fit: a personal Gmail, a second one, a school account.
 * The first account that granted Calendar and Classroom is the main one and
 * they read from it; every account with the Gmail permission feeds the email
 * view. Scopes are stored without Google's long URL prefix so five accounts
 * stay well inside a browser's 4 KB cookie limit.
 *
 * The sealing is done here rather than by the framework: TanStack Start
 * dropped its h3-backed `useSession` helpers, and a cookie this app encrypts
 * itself has no framework version to drift with. Without
 * `TOKEN_ENCRYPTION_KEY` the connect flow refuses to start rather than writing
 * a token somewhere unencrypted.
 */

import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { decryptSecret, encryptSecret, serverEnv } from "./env";

export interface GoogleAccount {
  refreshToken: string;
  email?: string | undefined;
  /** Space-separated, full scope URLs. */
  scope: string;
  connectedAt?: string | undefined;
  /** When this token was last granted. Newer wins when browsers disagree. */
  grantedAt?: string | undefined;
}

/** What the cookie holds. The single-account fields are the old format, still read. */
export interface SealedGoogle {
  accounts?: Array<{ t: string; e?: string; s?: string; c?: string; g?: string }>;
  oauthState?: string;
  refreshToken?: string;
  email?: string;
  scope?: string;
  connectedAt?: string;
}

export const MAX_GOOGLE_ACCOUNTS = 5;

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "TOKEN_ENCRYPTION_KEY is not set. The app will not store a Google refresh token without it.",
    );
    this.name = "EncryptionKeyMissingError";
  }
}

const COOKIE = "planner_google";
/** The cookie's earlier name. Still read, so nobody has to reconnect; replaced on the next write. */
const LEGACY_COOKIE = "aaditos_google";
const MAX_AGE = 60 * 60 * 24 * 180;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: MAX_AGE,
};

const SCOPE_PREFIX = "https://www.googleapis.com/auth/";

/** "https://www.googleapis.com/auth/gmail.readonly" → "gmail.readonly"; "openid" → "=openid". */
export function packScopes(scope: string): string {
  return scope
    .split(" ")
    .filter(Boolean)
    .map((s) => (s.startsWith(SCOPE_PREFIX) ? s.slice(SCOPE_PREFIX.length) : `=${s}`))
    .join(" ");
}

export function unpackScopes(packed: string): string {
  return packed
    .split(" ")
    .filter(Boolean)
    .map((s) => (s.startsWith("=") ? s.slice(1) : `${SCOPE_PREFIX}${s}`))
    .join(" ");
}

export function encryptionReady(): boolean {
  const key = serverEnv.tokenEncryptionKey;
  return Boolean(key && key.length >= 32);
}

function requireKey(): void {
  if (!encryptionReady()) throw new EncryptionKeyMissingError();
}

async function readSealed(): Promise<SealedGoogle> {
  if (!encryptionReady()) return {};
  try {
    const sealed = getCookie(COOKIE) ?? getCookie(LEGACY_COOKIE);
    if (!sealed) return {};
    const parsed = JSON.parse(await decryptSecret(sealed)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SealedGoogle) : {};
  } catch {
    // A key rotation, a cookie from the old framework format, or tampering:
    // every one of these reads as "not connected".
    return {};
  }
}

async function writeSealed(next: SealedGoogle): Promise<void> {
  requireKey();
  setCookie(COOKIE, await encryptSecret(JSON.stringify(next)), COOKIE_OPTIONS);
  if (getCookie(LEGACY_COOKIE)) deleteCookie(LEGACY_COOKIE, { path: "/" });
}

function clearCookies(): void {
  deleteCookie(COOKIE, { path: "/" });
  deleteCookie(LEGACY_COOKIE, { path: "/" });
}

/** Every connected account, in the order connected. Reads the old one-account format too. */
export function accountsFrom(sealed: SealedGoogle): GoogleAccount[] {
  if (Array.isArray(sealed.accounts)) {
    return sealed.accounts
      .filter((a) => typeof a?.t === "string" && a.t.length > 0)
      .map((a) => ({
        refreshToken: a.t,
        email: a.e,
        scope: unpackScopes(a.s ?? ""),
        connectedAt: a.c,
        grantedAt: a.g,
      }));
  }
  if (sealed.refreshToken) {
    return [
      {
        refreshToken: sealed.refreshToken,
        email: sealed.email,
        scope: sealed.scope ?? "",
        connectedAt: sealed.connectedAt,
      },
    ];
  }
  return [];
}

export function toSealed(accounts: GoogleAccount[], oauthState?: string): SealedGoogle {
  return {
    accounts: accounts.map((a) => ({
      t: a.refreshToken,
      ...(a.email ? { e: a.email } : {}),
      s: packScopes(a.scope),
      ...(a.connectedAt ? { c: a.connectedAt } : {}),
      ...(a.grantedAt ? { g: a.grantedAt } : {}),
    })),
    ...(oauthState ? { oauthState } : {}),
  };
}

export async function readGoogleAccounts(): Promise<GoogleAccount[]> {
  return accountsFrom(await readSealed());
}

/**
 * The account Calendar and Classroom read from: the first one that granted
 * them. None when every connected account is a mailbox only — falling back
 * to one of those made Classroom ask to "reconnect" an account that never
 * had it, and labelled a mailbox as the calendar account.
 */
export function mainAccount(accounts: GoogleAccount[]): GoogleAccount | undefined {
  return accounts.find((a) => /calendar|classroom/.test(a.scope));
}

export async function readOauthState(): Promise<string | undefined> {
  return (await readSealed()).oauthState;
}

/** Remembers the anti-forgery value for the consent round trip that is starting. */
export async function writeOauthState(state: string): Promise<void> {
  await writeSealed(toSealed(accountsFrom(await readSealed()), state));
}

/**
 * Adds an account, or refreshes one already connected at that address: the
 * new token replaces the old one and the permissions are merged, so granting
 * Gmail later never drops Calendar. Past the limit the newest is refused.
 */
export function mergeAccount(accounts: GoogleAccount[], incoming: GoogleAccount): GoogleAccount[] {
  const key = incoming.email?.toLowerCase();
  const index = key ? accounts.findIndex((a) => a.email?.toLowerCase() === key) : -1;
  if (index === -1) return [...accounts, incoming].slice(0, MAX_GOOGLE_ACCOUNTS);
  const existing = accounts[index];
  const scopes = new Set(
    [...(existing?.scope ?? "").split(" "), ...incoming.scope.split(" ")].filter(Boolean),
  );
  const merged: GoogleAccount = {
    ...incoming,
    scope: [...scopes].join(" "),
    connectedAt: existing?.connectedAt ?? incoming.connectedAt,
    grantedAt: incoming.grantedAt ?? existing?.grantedAt,
  };
  return accounts.map((a, i) => (i === index ? merged : a));
}

/**
 * Makes this browser's cookie hold exactly these accounts, keeping any
 * consent round trip in flight. Used to mirror what is saved for the person.
 */
export async function writeGoogleAccounts(accounts: GoogleAccount[]): Promise<void> {
  const sealed = await readSealed();
  if (accounts.length === 0 && !sealed.oauthState) {
    clearCookies();
    return;
  }
  await writeSealed(toSealed(accounts, sealed.oauthState));
}

/** Saves an account and ends the consent round trip. */
export async function saveGoogleAccount(incoming: GoogleAccount): Promise<GoogleAccount[]> {
  const next = mergeAccount(accountsFrom(await readSealed()), incoming);
  await writeSealed(toSealed(next));
  return next;
}

/** Removes one account by address, or every account when none is given. */
export async function removeGoogleAccount(email?: string): Promise<GoogleAccount[]> {
  if (!email) {
    clearCookies();
    return [];
  }
  const key = email.toLowerCase();
  const next = accountsFrom(await readSealed()).filter((a) => a.email?.toLowerCase() !== key);
  if (next.length === 0) clearCookies();
  else await writeSealed(toSealed(next));
  return next;
}

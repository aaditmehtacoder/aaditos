/**
 * Which Google accounts a request can use.
 *
 * Signed in: what is saved for that person, with this browser's cookie folded
 * in (so an account connected here reaches every other computer) and the
 * cookie then updated to match (so this browser agrees with the rest).
 * Not signed in, or nowhere to save: this browser's cookie alone, as before.
 */

import { bearerToken, verifySupabaseToken } from "./auth";
import {
  mergeAccount,
  readGoogleAccounts,
  removeGoogleAccount,
  writeGoogleAccounts,
  type GoogleAccount,
} from "./google-session";
import { loadStoredAccounts, reconcile, saveStoredAccounts } from "./google-store";

const same = (a: GoogleAccount[], b: GoogleAccount[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.email === b[i]?.email && x.refreshToken === b[i]?.refreshToken && x.scope === b[i]?.scope,
  );

/** The verified signed-in user behind a request, or null. */
export async function requestUser(request: Request): Promise<string | null> {
  const token = bearerToken(request);
  return token ? verifySupabaseToken(token) : null;
}

export async function accountsForUser(userId: string | null): Promise<GoogleAccount[]> {
  const cookie = await readGoogleAccounts();
  if (!userId) return cookie;
  let stored;
  try {
    stored = await loadStoredAccounts(userId);
  } catch (error) {
    console.warn("[google] saved accounts unavailable; using this browser's", {
      message: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    });
    return cookie;
  }
  if (!stored) return cookie;
  const { next, changed } = reconcile(stored, cookie, mergeAccount);
  if (changed) {
    await saveStoredAccounts(userId, next).catch((error: unknown) =>
      console.warn("[google] could not save accounts", {
        message: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      }),
    );
  }
  if (!same(cookie, next.accounts)) await writeGoogleAccounts(next.accounts).catch(() => undefined);
  return next.accounts;
}

/** Removes an account (or all) here and, when signed in, everywhere. */
export async function removeAccountForUser(
  userId: string | null,
  email?: string,
): Promise<GoogleAccount[]> {
  const left = await removeGoogleAccount(email);
  if (!userId) return left;
  const stored = await loadStoredAccounts(userId).catch(() => null);
  if (!stored) return left;
  const now = new Date().toISOString();
  const key = email?.toLowerCase();
  const gone = stored.accounts.filter((a) => !key || a.email?.toLowerCase() === key);
  const removed = { ...stored.removed };
  for (const a of gone) if (a.email) removed[a.email.toLowerCase()] = now;
  const accounts = key ? stored.accounts.filter((a) => a.email?.toLowerCase() !== key) : [];
  await saveStoredAccounts(userId, { accounts, removed });
  return accounts;
}

/**
 * The connected Google accounts, kept with the person rather than the browser.
 *
 * A sealed cookie holds them in one browser; this keeps them for the signed-in
 * account, so the Chromebook sees the same inboxes as the Mac without
 * connecting again. One object per user in a private Storage bucket that no
 * Row Level Security policy opens — only the service role can read it — and
 * the contents are AES-GCM encrypted with `TOKEN_ENCRYPTION_KEY` on top, so a
 * leaked bucket is still not a leaked token.
 *
 * Removals are remembered (with when), so a browser still holding an old
 * cookie cannot quietly bring back an account removed somewhere else.
 */

import { decryptSecret, encryptSecret } from "./env";
import { adminConfig } from "./supabase-admin";
import { accountsFrom, toSealed, type GoogleAccount, type SealedGoogle } from "./google-session";

const BUCKET = "vault";

export interface StoredAccounts {
  accounts: GoogleAccount[];
  /** Lowercased address → ISO time it was removed. */
  removed: Record<string, string>;
}

interface Blob {
  v: 1;
  sealed: SealedGoogle;
  removed?: Record<string, string>;
}

function objectUrl(base: string, userId: string): string {
  return `${base}/storage/v1/object/${BUCKET}/google/${encodeURIComponent(userId)}.json`;
}

/** Null when there is nowhere to keep them (no service role): callers fall back to the cookie. */
export async function loadStoredAccounts(
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredAccounts | null> {
  const config = adminConfig();
  if (!config) return null;
  const response = await fetchImpl(objectUrl(config.url, userId), {
    headers: { apikey: config.key, authorization: `Bearer ${config.key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 400 || response.status === 404) return { accounts: [], removed: {} };
  if (!response.ok) throw new Error(`Could not read saved accounts (${response.status}).`);
  try {
    const blob = JSON.parse(await decryptSecret(await response.text())) as Blob;
    return { accounts: accountsFrom(blob.sealed ?? {}), removed: blob.removed ?? {} };
  } catch {
    // A rotated key makes old tokens useless anyway; start clean.
    return { accounts: [], removed: {} };
  }
}

async function createBucket(base: string, key: string, fetchImpl: typeof fetch): Promise<void> {
  await fetchImpl(`${base}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 65536 }),
    signal: AbortSignal.timeout(8000),
  });
}

export async function saveStoredAccounts(
  userId: string,
  stored: StoredAccounts,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const config = adminConfig();
  if (!config) return;
  const body = await encryptSecret(
    JSON.stringify({
      v: 1,
      sealed: toSealed(stored.accounts),
      removed: stored.removed,
    } satisfies Blob),
  );
  const put = () =>
    fetchImpl(objectUrl(config.url, userId), {
      method: "POST",
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        "content-type": "text/plain",
        "x-upsert": "true",
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
  let response = await put();
  if (response.status === 404 || response.status === 400) {
    // First save on a fresh project: the bucket does not exist yet.
    await createBucket(config.url, config.key, fetchImpl);
    response = await put();
  }
  if (!response.ok) throw new Error(`Could not save accounts (${response.status}).`);
}

const keyOf = (a: GoogleAccount) => (a.email ?? "").toLowerCase();

/**
 * Folds one browser's cookie into what is saved for the person. A cookie
 * account wins when it is new here or was granted more recently; one removed
 * elsewhere after it was granted stays removed. Pure, for tests.
 */
export function reconcile(
  stored: StoredAccounts,
  cookie: GoogleAccount[],
  merge: (accounts: GoogleAccount[], incoming: GoogleAccount) => GoogleAccount[],
): { next: StoredAccounts; changed: boolean } {
  let accounts = stored.accounts;
  const removed = { ...stored.removed };
  let changed = false;
  for (const account of cookie) {
    const key = keyOf(account);
    if (!key) continue;
    const removedAt = removed[key];
    if (removedAt && (!account.grantedAt || account.grantedAt <= removedAt)) continue;
    const existing = accounts.find((a) => keyOf(a) === key);
    const newer =
      !existing ||
      (account.grantedAt ?? "") > (existing.grantedAt ?? "") ||
      (!existing.grantedAt && account.refreshToken !== existing.refreshToken);
    if (!newer) continue;
    accounts = merge(accounts, account);
    delete removed[key];
    changed = true;
  }
  return { next: { accounts, removed }, changed };
}

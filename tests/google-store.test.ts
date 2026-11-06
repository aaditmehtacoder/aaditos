// @vitest-environment node
import { describe, expect, it } from "vitest";

import { mergeAccount, type GoogleAccount } from "@/server/google-session";
import { reconcile } from "@/server/google-store";

const acct = (
  email: string,
  grantedAt?: string,
  token = `tok-${email}-${grantedAt ?? "old"}`,
): GoogleAccount => ({
  refreshToken: token,
  email,
  scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
  grantedAt,
});

describe("reconcile: one person's accounts across computers", () => {
  it("brings an account connected on this computer into the saved set", () => {
    const { next, changed } = reconcile(
      { accounts: [], removed: {} },
      [acct("a@gmail.com", "2026-11-05T10:00:00Z")],
      mergeAccount,
    );
    expect(changed).toBe(true);
    expect(next.accounts.map((a) => a.email)).toEqual(["a@gmail.com"]);
  });

  it("keeps the saved token when this computer's copy is older", () => {
    const saved = acct("a@gmail.com", "2026-11-05T12:00:00Z", "new");
    const { next, changed } = reconcile(
      { accounts: [saved], removed: {} },
      [acct("a@gmail.com", "2026-11-05T10:00:00Z", "stale")],
      mergeAccount,
    );
    expect(changed).toBe(false);
    expect(next.accounts[0]?.refreshToken).toBe("new");
  });

  it("takes this computer's token when it was granted more recently", () => {
    const { next } = reconcile(
      { accounts: [acct("a@gmail.com", "2026-11-05T10:00:00Z", "old")], removed: {} },
      [acct("a@gmail.com", "2026-11-05T12:00:00Z", "fresh")],
      mergeAccount,
    );
    expect(next.accounts[0]?.refreshToken).toBe("fresh");
  });

  it("does not let a stale cookie bring back an account removed on another computer", () => {
    const { next, changed } = reconcile(
      { accounts: [], removed: { "a@gmail.com": "2026-11-05T11:00:00Z" } },
      [acct("a@gmail.com", "2026-11-05T10:00:00Z")],
      mergeAccount,
    );
    expect(changed).toBe(false);
    expect(next.accounts).toHaveLength(0);
  });

  it("lets the same account back in when it is connected again after removal", () => {
    const { next } = reconcile(
      { accounts: [], removed: { "a@gmail.com": "2026-11-05T11:00:00Z" } },
      [acct("a@gmail.com", "2026-11-05T13:00:00Z")],
      mergeAccount,
    );
    expect(next.accounts.map((a) => a.email)).toEqual(["a@gmail.com"]);
    expect(next.removed).toEqual({});
  });

  it("moves accounts connected before grant times existed", () => {
    const { next } = reconcile(
      { accounts: [], removed: {} },
      [acct("legacy@gmail.com")],
      mergeAccount,
    );
    expect(next.accounts.map((a) => a.email)).toEqual(["legacy@gmail.com"]);
  });
});

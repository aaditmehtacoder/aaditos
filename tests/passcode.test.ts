/**
 * Passcode sign-in.
 *
 * The passcode is short by design, so the properties worth pinning are the ones
 * that keep it from being weak: the typed passcode is never the stored password,
 * the derived password is long and account-specific, and rotating the secret
 * invalidates every derived password at once.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PASSCODE_ACCOUNTS,
  accountFor,
  derivePassword,
  passcodeConfigured,
  passcodeMatches,
} from "@/server/passcode";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env["APP_PASSCODE"] = "cwb";
  process.env["ACCOUNT_PASSWORD_SECRET"] = "a".repeat(64);
  process.env["VITE_SUPABASE_URL"] = "https://example.supabase.co";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("PASSCODE_ACCOUNTS", () => {
  it("exposes a stable id per account so the client never sends an email", () => {
    for (const account of PASSCODE_ACCOUNTS) {
      expect(account.id).toMatch(/^[a-z]+$/);
      expect(accountFor(account.id)?.email).toBe(account.email);
    }
  });

  it("rejects an unknown account id", () => {
    expect(accountFor("administrator")).toBeUndefined();
  });
});

describe("passcodeConfigured", () => {
  it("is false when the derivation secret is missing, even with a passcode set", () => {
    delete process.env["ACCOUNT_PASSWORD_SECRET"];
    expect(passcodeConfigured()).toBe(false);
  });

  it("is false when no passcode is set, so the door stays shut by default", () => {
    delete process.env["APP_PASSCODE"];
    expect(passcodeConfigured()).toBe(false);
  });

  it("is true once both are present", () => {
    expect(passcodeConfigured()).toBe(true);
  });
});

describe("passcodeMatches", () => {
  it("accepts the configured passcode", async () => {
    await expect(passcodeMatches("cwb")).resolves.toBe(true);
  });

  it("ignores surrounding whitespace, which a phone keyboard adds freely", async () => {
    await expect(passcodeMatches("  cwb ")).resolves.toBe(true);
  });

  it("is case sensitive", async () => {
    await expect(passcodeMatches("CWB")).resolves.toBe(false);
  });

  it("rejects a prefix and a near miss", async () => {
    await expect(passcodeMatches("cw")).resolves.toBe(false);
    await expect(passcodeMatches("cwbb")).resolves.toBe(false);
    await expect(passcodeMatches("")).resolves.toBe(false);
  });

  it("rejects everything when no passcode is configured", async () => {
    delete process.env["APP_PASSCODE"];
    await expect(passcodeMatches("cwb")).resolves.toBe(false);
    await expect(passcodeMatches("")).resolves.toBe(false);
  });
});

describe("derivePassword", () => {
  it("never returns the passcode itself", async () => {
    const password = await derivePassword("aaditmehtacoder@gmail.com");
    expect(password).not.toContain("cwb");
  });

  it("clears Supabase's six-character minimum by a wide margin", async () => {
    expect((await derivePassword("aaditmehtacoder@gmail.com")).length).toBe(48);
  });

  it("is deterministic, so it never has to be stored anywhere", async () => {
    const a = await derivePassword("aaditmehta1@gmail.com");
    const b = await derivePassword("aaditmehta1@gmail.com");
    expect(a).toBe(b);
  });

  it("gives each account a different password", async () => {
    const coder = await derivePassword("aaditmehtacoder@gmail.com");
    const personal = await derivePassword("aaditmehta1@gmail.com");
    expect(coder).not.toBe(personal);
  });

  it("treats the email case-insensitively, matching Supabase", async () => {
    const lower = await derivePassword("aaditmehta1@gmail.com");
    const upper = await derivePassword("AaditMehta1@Gmail.com");
    expect(lower).toBe(upper);
  });

  /** Rotating the secret is the revocation mechanism; it must actually change everything. */
  it("changes for every account when the secret is rotated", async () => {
    const before = await derivePassword("aaditmehta1@gmail.com");
    process.env["ACCOUNT_PASSWORD_SECRET"] = "b".repeat(64);
    const after = await derivePassword("aaditmehta1@gmail.com");
    expect(after).not.toBe(before);
  });

  it("refuses to derive anything without a secret", async () => {
    delete process.env["ACCOUNT_PASSWORD_SECRET"];
    await expect(derivePassword("aaditmehta1@gmail.com")).rejects.toThrow(
      /ACCOUNT_PASSWORD_SECRET/,
    );
  });
});

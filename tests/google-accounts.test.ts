// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_GOOGLE_ACCOUNTS,
  accountsFrom,
  mainAccount,
  mergeAccount,
  packScopes,
  toSealed,
  unpackScopes,
  type GoogleAccount,
} from "@/server/google-session";
import { GMAIL_SCOPE, fetchGmail } from "@/server/providers/gmail";
import { GOOGLE_SCOPES } from "@/server/providers/google";

const FULL = [...GOOGLE_SCOPES, GMAIL_SCOPE].join(" ");
const account = (email: string, scope = FULL): GoogleAccount => ({
  refreshToken: `1//0g${"x".repeat(98)}${email.length}`,
  email,
  scope,
  connectedAt: "2026-11-05T20:00:00.000Z",
});

describe("several Google accounts in one sealed cookie", () => {
  it("stores scopes short and reads them back exactly", () => {
    expect(packScopes(FULL)).not.toContain("googleapis.com");
    expect(unpackScopes(packScopes(FULL))).toBe(FULL);
  });

  it("still reads a cookie written before there was more than one account", () => {
    expect(accountsFrom({ refreshToken: "tok", email: "old@gmail.com", scope: "openid" })).toEqual([
      { refreshToken: "tok", email: "old@gmail.com", scope: "openid", connectedAt: undefined },
    ]);
  });

  it("adds a new address and refreshes a known one without losing permissions", () => {
    const first = [account("main@gmail.com")];
    const added = mergeAccount(first, account("second@gmail.com", `openid email ${GMAIL_SCOPE}`));
    expect(added.map((a) => a.email)).toEqual(["main@gmail.com", "second@gmail.com"]);

    const again = mergeAccount(added, {
      ...account("MAIN@gmail.com", "openid"),
      refreshToken: "new",
    });
    expect(again).toHaveLength(2);
    expect(again[0]?.refreshToken).toBe("new");
    expect(again[0]?.scope).toContain("calendar.readonly");
  });

  it("keeps Calendar and Classroom on the account that granted them", () => {
    const accounts = [
      account("mail-only@gmail.com", `openid email ${GMAIL_SCOPE}`),
      account("main@gmail.com"),
    ];
    expect(mainAccount(accounts)?.email).toBe("main@gmail.com");
  });

  it("holds five accounts inside a browser's 4 KB cookie limit", () => {
    const five = Array.from({ length: MAX_GOOGLE_ACCOUNTS }, (_, i) =>
      account(`someone.with.a.long.name${i}@school-district.example.net`),
    );
    const json = JSON.stringify(toSealed(five, "a3f1c2d4-0000-4000-8000-123456789abc"));
    // AES-GCM adds a 16-byte tag and a 12-byte IV; base64 grows it by a third.
    const sealedLength = Math.ceil(((json.length + 16) * 4) / 3) + 17;
    expect(sealedLength + "planner_google=".length).toBeLessThan(4000);
    expect(mergeAccount(five, account("sixth@gmail.com"))).toHaveLength(MAX_GOOGLE_ACCOUNTS);
  });
});

describe("fetchGmail across accounts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads every mailbox, labels each email with its account, and survives one failing", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    // Token refresh: one account's consent has lapsed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const token = new URLSearchParams(String(init.body)).get("refresh_token");
        return token === "lapsed"
          ? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
          : new Response(JSON.stringify({ access_token: `at-${token}` }), { status: 200 });
      }),
    );
    const gmailApi = vi.fn(async (url: string, init: RequestInit) => {
      const who = String((init.headers as Record<string, string>)["authorization"]).replace(
        "Bearer at-",
        "",
      );
      if (url.includes("/labels/INBOX"))
        return Response.json({ threadsUnread: who === "a" ? 3 : 1 });
      if (url.includes("/messages?")) return Response.json({ messages: [{ id: `${who}1` }] });
      return Response.json({
        id: `${who}1`,
        threadId: `t-${who}`,
        internalDate: who === "a" ? "1760900000000" : "1760990000000",
        labelIds: who === "a" ? ["INBOX", "UNREAD"] : ["INBOX"],
        payload: { headers: [{ name: "Subject", value: `Hello from ${who}` }] },
      });
    });

    const result = await fetchGmail(
      {
        accounts: [
          { refreshToken: "a", grantedScope: GMAIL_SCOPE, email: "a@gmail.com" },
          { refreshToken: "b", grantedScope: GMAIL_SCOPE, email: "b@school.net" },
          { refreshToken: "lapsed", grantedScope: GMAIL_SCOPE, email: "c@gmail.com" },
          { refreshToken: "d", grantedScope: "openid", email: "calendar-only@gmail.com" },
        ],
      },
      gmailApi as unknown as typeof fetch,
    );

    expect(result.ok).toBe(true);
    expect(result.items.map((i) => i.account)).toEqual(["b@school.net", "a@gmail.com"]);
    expect(result.items.find((i) => i.account === "a@gmail.com")?.unread).toBe(true);
    expect(result.items[0]?.url).toContain("authuser=b%40school.net");
    expect(result.accounts).toEqual([
      { email: "a@gmail.com", ok: true, unread: 3 },
      { email: "b@school.net", ok: true, unread: 1 },
      expect.objectContaining({ email: "c@gmail.com", ok: false }),
    ]);
    expect(result.error).toMatch(/c@gmail.com: .*Reconnect/);
  });
});

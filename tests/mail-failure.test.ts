// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { mailFailure } from "@/server/mail-access";
import { GoogleReconnectError, accessTokenFromRefresh } from "@/server/providers/google";

afterEach(() => vi.unstubAllGlobals());

function googleAnswers(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("an expired Google connection", () => {
  it("is told apart from other refresh failures", async () => {
    googleAnswers(400, {
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    });
    await expect(accessTokenFromRefresh("old")).rejects.toBeInstanceOf(GoogleReconnectError);

    googleAnswers(500, { error: "internal_failure", error_description: "Backend error" });
    const other = await accessTokenFromRefresh("x").catch((e: unknown) => e);
    expect(other).not.toBeInstanceOf(GoogleReconnectError);
    expect((other as Error).message).toBe("Backend error");
  });

  it("answers with a reconnect code the page can act on", async () => {
    const response = mailFailure(new GoogleReconnectError("expired"), "fallback");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, code: "reconnect" });
  });
});

describe("mailFailure", () => {
  // Cloudflare replaces 502 and 504 from the origin with its own HTML page,
  // which is how "Request failed (502)" hid the real reason.
  it("never answers 502 or 504, and keeps the reason", async () => {
    const response = mailFailure(new Error("Gmail is down."), "fallback");
    expect([502, 504]).not.toContain(response.status);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, message: "Gmail is down." });
    expect(await mailFailure("odd", "Gmail did not answer.").json()).toEqual({
      ok: false,
      message: "Gmail did not answer.",
    });
  });
});

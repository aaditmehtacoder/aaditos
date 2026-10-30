import { describe, expect, it } from "vitest";

import { stripBase, withBase } from "@/lib/base-path";
import { GATE_HEADER, admit } from "@/server/gate";

const SECRET = "s3cret-s3cret-s3cret";

function req(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://aaditos.vercel.app${path}`, { headers });
}

describe("the gate in front of the server", () => {
  it("lets everything through when no secret is configured", () => {
    const verdict = admit(req("/signin"), { secret: undefined, base: "/" });
    expect(verdict.kind).toBe("pass");
  });

  it("answers 404 to a request without the proxy's header", async () => {
    const verdict = admit(req("/signin"), { secret: SECRET, base: "/" });
    expect(verdict.kind).toBe("reject");
    if (verdict.kind === "reject") {
      expect(verdict.response.status).toBe(404);
      expect(verdict.response.headers.get("cache-control")).toBe("no-store");
      expect(await verdict.response.text()).toBe("Not found");
    }
  });

  it("rejects a wrong header, including one of the right length", () => {
    const wrong = SECRET.replace(/.$/, "x");
    expect(admit(req("/", { [GATE_HEADER]: wrong }), { secret: SECRET, base: "/" }).kind).toBe(
      "reject",
    );
    expect(admit(req("/", { [GATE_HEADER]: "" }), { secret: SECRET, base: "/" }).kind).toBe(
      "reject",
    );
  });

  it("passes a request that carries the header", () => {
    const verdict = admit(req("/123/signin", { [GATE_HEADER]: SECRET }), {
      secret: SECRET,
      base: "/123/",
    });
    expect(verdict.kind).toBe("pass");
    if (verdict.kind === "pass") expect(new URL(verdict.request.url).pathname).toBe("/123/signin");
  });

  it("moves the scheduler's cron call under the prefix without asking for the header", () => {
    const verdict = admit(req("/api/cron/sync?secret=abc"), { secret: SECRET, base: "/123/" });
    expect(verdict.kind).toBe("pass");
    if (verdict.kind === "pass") {
      const url = new URL(verdict.request.url);
      expect(url.pathname).toBe("/123/api/cron/sync");
      expect(url.searchParams.get("secret")).toBe("abc");
    }
  });

  it("leaves the cron path alone at the root", () => {
    const verdict = admit(req("/api/cron/sync"), { secret: SECRET, base: "/" });
    expect(verdict.kind).toBe("pass");
    if (verdict.kind === "pass")
      expect(new URL(verdict.request.url).pathname).toBe("/api/cron/sync");
  });
});

describe("base path helpers", () => {
  // Vitest serves the app at "/", so these are the root-mounted cases.
  it("prefixes without doubling slashes", () => {
    expect(withBase("/api/compass")).toBe("/api/compass");
    expect(withBase("api/compass")).toBe("/api/compass");
    expect(withBase("/")).toBe("/");
  });

  it("strips nothing when there is no prefix", () => {
    expect(stripBase("/classes")).toBe("/classes");
  });
});

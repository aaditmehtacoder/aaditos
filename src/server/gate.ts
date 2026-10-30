/**
 * The door in front of every request.
 *
 * When the app is only meant to be reached through aaditmehta.dev's proxy,
 * `AADITOS_GATE_SECRET` is set on both sides. The proxy sends it in a header;
 * anyone who finds the deployment itself and knocks without it gets a 404,
 * which is the honest answer — as far as they are concerned there is nothing
 * here. Static files are served by the host before this runs; they are
 * build output and carry nothing personal.
 *
 * One caller is let through on the path alone: the host's cron scheduler,
 * which calls `/api/cron/sync` at the root of the deployment with no prefix
 * and no header. That route checks `CRON_SECRET` itself.
 */

export const GATE_HEADER = "x-aaditos-gate";

const CRON_PATH = "/api/cron/sync";

export type Admission = { kind: "pass"; request: Request } | { kind: "reject"; response: Response };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function admit(
  request: Request,
  opts: { secret: string | undefined; base: string },
): Admission {
  const url = new URL(request.url);

  if (url.pathname === CRON_PATH) {
    if (opts.base === "/") return { kind: "pass", request };
    // The router lives under the prefix; move the scheduler's call there.
    url.pathname = `${opts.base}${CRON_PATH.slice(1)}`;
    return { kind: "pass", request: new Request(url, request) };
  }

  if (opts.secret) {
    const given = request.headers.get(GATE_HEADER) ?? "";
    if (!constantTimeEqual(given, opts.secret)) {
      return {
        kind: "reject",
        response: new Response("Not found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        }),
      };
    }
  }

  return { kind: "pass", request };
}

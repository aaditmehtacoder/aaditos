import { createFileRoute } from "@tanstack/react-router";

import { json, mailAccess } from "@/server/mail-access";
import { parseRecipients, sendNewMail } from "@/server/providers/gmail-mailbox";

/**
 * Sends a new email (or a forward) that the person wrote and pressed Send
 * on. Recipients are checked one by one; nothing calls this on its own.
 */
export const Route = createFileRoute("/api/gmail/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          account?: unknown;
          to?: unknown;
          cc?: unknown;
          bcc?: unknown;
          subject?: unknown;
          text?: unknown;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, message: "Invalid JSON body." }, 400);
        }
        const str = (v: unknown) => (typeof v === "string" ? v : "");
        const lists = [str(body.to), str(body.cc), str(body.bcc)].map(parseRecipients);
        const bad = lists.find((l) => !l.ok);
        if (bad && !bad.ok)
          return json({ ok: false, message: `"${bad.bad}" is not an email address.` }, 400);
        const [to, cc, bcc] = lists.map((l) => (l.ok ? l.list : []));
        if (!to || to.length === 0)
          return json({ ok: false, message: "Add someone to send it to." }, 400);
        if (to.length + (cc?.length ?? 0) + (bcc?.length ?? 0) > 25) {
          return json({ ok: false, message: "Up to 25 recipients at a time." }, 400);
        }
        const text = str(body.text).trim();
        if (!text) return json({ ok: false, message: "Write something first." }, 400);
        if (text.length > 50_000) {
          return json({ ok: false, message: "An email can be up to 50,000 characters." }, 400);
        }
        const access = await mailAccess(request, str(body.account) || null, {
          max: 10,
          dailyMax: 150,
        });
        if (!access.ok) return access.response;
        try {
          const sent = await sendNewMail(access.account, {
            to,
            cc: cc ?? [],
            bcc: bcc ?? [],
            subject: str(body.subject).slice(0, 500),
            body: text,
          });
          return json({ ok: true, threadId: sent.threadId, to });
        } catch (error) {
          console.error("[gmail] send failed", {
            message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
          });
          return json(
            {
              ok: false,
              message: error instanceof Error ? error.message : "Gmail did not send it.",
            },
            502,
          );
        }
      },
    },
  },
});

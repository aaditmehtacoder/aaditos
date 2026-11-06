import { createFileRoute } from "@tanstack/react-router";

import { gmailId, json, mailAccess } from "@/server/mail-access";
import { sendGmailReply } from "@/server/providers/gmail";

/**
 * Sends a reply the person wrote and pressed Send on.
 *
 * Only a reply: the recipient, subject and threading all come from the
 * original email as Gmail stores it, so this can answer whoever wrote and
 * nobody else. Nothing calls it on its own.
 */
export const Route = createFileRoute("/api/gmail/reply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { account?: unknown; id?: unknown; text?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, message: "Invalid JSON body." }, 400);
        }
        const id = gmailId(body.id);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!id) return json({ ok: false, message: "No such email." }, 400);
        if (!text) return json({ ok: false, message: "Write something first." }, 400);
        if (text.length > 20_000) {
          return json({ ok: false, message: "A reply can be up to 20,000 characters." }, 400);
        }
        const access = await mailAccess(
          request,
          typeof body.account === "string" ? body.account : null,
          { max: 10, dailyMax: 200 },
        );
        if (!access.ok) return access.response;
        try {
          const sent = await sendGmailReply(access.account, id, text);
          return json({ ok: true, to: sent.to, threadId: sent.threadId });
        } catch (error) {
          console.error("[gmail] reply failed", {
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

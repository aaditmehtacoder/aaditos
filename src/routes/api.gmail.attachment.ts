import { createFileRoute } from "@tanstack/react-router";

import { gmailId, json, mailAccess } from "@/server/mail-access";
import { MAX_ATTACHMENT_BYTES, fetchAttachment } from "@/server/providers/gmail-mailbox";

/**
 * One attachment's bytes, always as a download (octet-stream, nosniff):
 * the page decides whether a file is safe to show in a tab, so nothing a
 * sender attached is ever rendered by this origin as a web page.
 */
export const Route = createFileRoute("/api/gmail/attachment")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const messageId = gmailId(params.get("message"));
        const attachmentId = params.get("attachment") ?? undefined;
        const partId = params.get("part") ?? undefined;
        if (!messageId) return json({ ok: false, message: "No such email." }, 400);
        if (attachmentId && !/^[A-Za-z0-9_-]{8,4000}$/.test(attachmentId)) {
          return json({ ok: false, message: "No such attachment." }, 400);
        }
        if (partId && !/^[0-9.]{1,24}$/.test(partId)) {
          return json({ ok: false, message: "No such attachment." }, 400);
        }
        if (!attachmentId && !partId)
          return json({ ok: false, message: "No such attachment." }, 400);
        const access = await mailAccess(request, params.get("account"), {
          max: 60,
          dailyMax: 1000,
        });
        if (!access.ok) return access.response;
        try {
          const bytes = await fetchAttachment(access.account, messageId, { attachmentId, partId });
          if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            return json(
              {
                ok: false,
                code: "too_big",
                message: "That file is too big to open here. Open it in Gmail.",
              },
              413,
            );
          }
          return new Response(bytes, {
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": "attachment",
              "x-content-type-options": "nosniff",
              "cache-control": "private, no-store",
            },
          });
        } catch (error) {
          return json(
            {
              ok: false,
              message: error instanceof Error ? error.message : "Gmail did not answer.",
            },
            502,
          );
        }
      },
    },
  },
});

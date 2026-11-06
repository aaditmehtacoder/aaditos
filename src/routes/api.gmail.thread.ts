import { createFileRoute } from "@tanstack/react-router";

import { gmailId, json, mailAccess } from "@/server/mail-access";
import { GMAIL_MODIFY_SCOPE, getThread } from "@/server/providers/gmail-mailbox";

/**
 * A whole conversation as plain text. Opening it marks it read, as Gmail
 * does — only when the account allowed changes; otherwise it stays as it was.
 */
export const Route = createFileRoute("/api/gmail/thread")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const id = gmailId(params.get("id"));
        if (!id) return json({ ok: false, message: "No such conversation." }, 400);
        const access = await mailAccess(request, params.get("account"), {
          max: 120,
          dailyMax: 5000,
        });
        if (!access.ok) return access.response;
        try {
          const thread = await getThread(access.account, id, {
            markRead: access.account.scope.split(" ").includes(GMAIL_MODIFY_SCOPE),
          });
          return json({ ok: true, thread });
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

import { createFileRoute } from "@tanstack/react-router";

import { json, mailAccess } from "@/server/mail-access";
import { mailCounts } from "@/server/providers/gmail-mailbox";

/** Unread in Inbox and Spam, and how many drafts, for the folder list. */
export const Route = createFileRoute("/api/gmail/counts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await mailAccess(request, new URL(request.url).searchParams.get("account"), {
          max: 60,
          dailyMax: 3000,
        });
        if (!access.ok) return access.response;
        try {
          return json({ ok: true, counts: await mailCounts(access.account) });
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

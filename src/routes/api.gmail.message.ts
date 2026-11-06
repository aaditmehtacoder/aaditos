import { createFileRoute } from "@tanstack/react-router";

import { gmailId, json, mailAccess } from "@/server/mail-access";
import { fetchGmailMessage } from "@/server/providers/gmail";

/** One email in full, as plain text, from the account it arrived in. Read-only. */
export const Route = createFileRoute("/api/gmail/message")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const id = gmailId(params.get("id"));
        if (!id) return json({ ok: false, message: "No such email." }, 400);
        const access = await mailAccess(request, params.get("account"), {
          max: 60,
          dailyMax: 2000,
        });
        if (!access.ok) return access.response;
        try {
          return json({ ok: true, message: await fetchGmailMessage(access.account, id) });
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

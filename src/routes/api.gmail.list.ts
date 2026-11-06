import { createFileRoute } from "@tanstack/react-router";

import { json, mailAccess } from "@/server/mail-access";
import { isCategory, isFolder, listMail } from "@/server/providers/gmail-mailbox";

/** One page of one folder (or a search) in one account. Read-only. */
export const Route = createFileRoute("/api/gmail/list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const folder = params.get("folder") ?? "inbox";
        const category = params.get("category") ?? undefined;
        if (!isFolder(folder)) return json({ ok: false, message: "No such folder." }, 400);
        if (category && !isCategory(category)) {
          return json({ ok: false, message: "No such category." }, 400);
        }
        const access = await mailAccess(request, params.get("account"), {
          max: 120,
          dailyMax: 5000,
        });
        if (!access.ok) return access.response;
        try {
          const page = await listMail(access.account, {
            folder,
            category: category && isCategory(category) ? category : undefined,
            q: params.get("q") ?? undefined,
            pageToken: params.get("pageToken") ?? undefined,
          });
          return json({ ok: true, ...page });
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

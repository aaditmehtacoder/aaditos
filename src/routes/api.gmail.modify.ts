import { createFileRoute } from "@tanstack/react-router";

import { gmailId, json, mailAccess } from "@/server/mail-access";
import { GMAIL_MODIFY_SCOPE, isAction, modifyThreads } from "@/server/providers/gmail-mailbox";

/**
 * Archive, star, read state, Important, Spam and Trash, on whole
 * conversations. Trash is Gmail's own and undoable for 30 days; there is no
 * delete here.
 */
export const Route = createFileRoute("/api/gmail/modify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { account?: unknown; threadIds?: unknown; action?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, message: "Invalid JSON body." }, 400);
        }
        if (!isAction(body.action)) return json({ ok: false, message: "No such action." }, 400);
        const ids = Array.isArray(body.threadIds)
          ? body.threadIds.map(gmailId).filter((id): id is string => id !== null)
          : [];
        if (ids.length === 0 || ids.length > 100) {
          return json({ ok: false, message: "Pick between 1 and 100 conversations." }, 400);
        }
        const access = await mailAccess(
          request,
          typeof body.account === "string" ? body.account : null,
          { max: 60, dailyMax: 3000 },
        );
        if (!access.ok) return access.response;
        if (!access.account.scope.split(" ").includes(GMAIL_MODIFY_SCOPE)) {
          return json(
            {
              ok: false,
              code: "needs_permission",
              message: "This account has not allowed changes yet.",
            },
            403,
          );
        }
        try {
          await modifyThreads(access.account, ids, body.action);
          return json({ ok: true, count: ids.length });
        } catch (error) {
          return json(
            {
              ok: false,
              message: error instanceof Error ? error.message : "Gmail did not change it.",
            },
            502,
          );
        }
      },
    },
  },
});

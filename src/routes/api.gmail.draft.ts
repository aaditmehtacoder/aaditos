import { createFileRoute } from "@tanstack/react-router";

import { withFallback } from "@/server/ai";
import { serverEnv } from "@/server/env";
import { gmailId, json, mailAccess } from "@/server/mail-access";
import { fetchGmailMessage, senderName } from "@/server/providers/gmail";

/**
 * Drafts a reply for the person to read, edit and send themselves.
 *
 * Returns text only. Nothing is sent from here; the reply route does that,
 * and only when Send is pressed.
 */
export const Route = createFileRoute("/api/gmail/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { account?: unknown; id?: unknown; instruction?: unknown; current?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, message: "Invalid JSON body." }, 400);
        }
        const id = gmailId(body.id);
        if (!id) return json({ ok: false, message: "No such email." }, 400);
        const instruction =
          typeof body.instruction === "string" ? body.instruction.trim().slice(0, 2000) : "";
        const current = typeof body.current === "string" ? body.current.trim().slice(0, 8000) : "";
        const access = await mailAccess(
          request,
          typeof body.account === "string" ? body.account : null,
          { max: 20, dailyMax: 300 },
        );
        if (!access.ok) return access.response;

        try {
          const message = await fetchGmailMessage(access.account, id);
          const { value } = await withFallback((openai, rung) =>
            openai.responses.create({
              model: rung.model,
              store: false,
              max_output_tokens: Math.min(2000, serverEnv.openaiMaxOutputTokens),
              instructions: [
                `Write the reply that ${access.account.email ?? "the account owner"} will send to this email. You are drafting it for them to edit; they press Send themselves.`,
                "- Reply in the language and register of the email: polite and complete to a teacher or an organisation, relaxed to a friend.",
                "- Answer what the email actually asks. If it needs a fact you do not have (a date, a yes or no, a number), leave a short bracketed gap like [time] rather than inventing one.",
                "- Short: a few sentences unless the instruction asks for more. No subject line, no quoted original, no markdown.",
                "- End with a simple sign-off such as 'Thanks,' on its own line, and no name after it.",
                "- Keep it appropriate for a 14-year-old to send.",
                instruction ? `- What they want to say: ${instruction}` : "",
                current
                  ? `- Improve this draft they already started, keeping their meaning:\n${current}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
              input: [
                {
                  role: "user",
                  content: `From: ${message.from}\nSubject: ${message.subject}\nDate: ${message.date}\n\n${message.text.slice(0, 12_000)}`,
                },
              ] as never,
            }),
          );
          const text = ((value as { output_text?: string }).output_text ?? "").trim();
          if (!text) return json({ ok: false, message: "No draft came back. Try again." }, 502);
          return json({ ok: true, text, to: senderName(message.from) });
        } catch (error) {
          return json(
            {
              ok: false,
              message: error instanceof Error ? error.message : "Could not draft a reply.",
            },
            502,
          );
        }
      },
    },
  },
});

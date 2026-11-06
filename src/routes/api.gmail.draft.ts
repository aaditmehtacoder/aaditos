import { createFileRoute } from "@tanstack/react-router";

import { withFallback } from "@/server/ai";
import { serverEnv } from "@/server/env";
import { gmailId, json, mailAccess } from "@/server/mail-access";
import { fetchGmailMessage, senderName } from "@/server/providers/gmail";

/**
 * Drafts an email for the person to read, edit and send themselves: a reply
 * to a message (`id`), or a new email from a few words (`instruction`, with
 * `to` and `subject` as context). Returns text only; nothing is sent here.
 */
export const Route = createFileRoute("/api/gmail/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          account?: unknown;
          id?: unknown;
          instruction?: unknown;
          current?: unknown;
          to?: unknown;
          subject?: unknown;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, message: "Invalid JSON body." }, 400);
        }
        const str = (v: unknown, max: number) =>
          typeof v === "string" ? v.trim().slice(0, max) : "";
        const id =
          body.id === undefined || body.id === null || body.id === "" ? null : gmailId(body.id);
        if (body.id && !id) return json({ ok: false, message: "No such email." }, 400);
        const instruction = str(body.instruction, 2000);
        const current = str(body.current, 8000);
        if (!id && !instruction && !current) {
          return json({ ok: false, message: "Say what the email should be about." }, 400);
        }
        const access = await mailAccess(request, str(body.account, 320) || null, {
          max: 20,
          dailyMax: 300,
        });
        if (!access.ok) return access.response;
        const me = access.account.email ?? "the account owner";

        try {
          const original = id ? await fetchGmailMessage(access.account, id) : null;
          const subject = str(body.subject, 300);
          const rules = [
            original
              ? `Write the reply that ${me} will send to this email. You are drafting it for them to edit; they press Send themselves.`
              : `Write a new email that ${me} will send${str(body.to, 500) ? ` to ${str(body.to, 500)}` : ""}. You are drafting it for them to edit; they press Send themselves.`,
            "- Match the register to the reader: polite and complete to a teacher or an organisation, relaxed to a friend.",
            original
              ? "- Answer what the email actually asks."
              : "- Say what they asked for, clearly, in the order a reader needs it.",
            "- If it needs a fact you do not have (a date, a yes or no, a number), leave a short bracketed gap like [time] rather than inventing one.",
            "- Short: a few sentences unless the instruction asks for more. No quoted original, no markdown.",
            "- Start with a greeting line when it suits the reader. End with a simple sign-off such as 'Thanks,' on its own line, and no name after it.",
            "- Keep it appropriate for a 14-year-old to send.",
            !original && !subject
              ? "- First line exactly: 'Subject: <a short subject>'. Then a blank line, then the email."
              : "- Do not write a subject line.",
            instruction ? `- What they want to say: ${instruction}` : "",
            current
              ? `- Improve this draft they already started, keeping their meaning:\n${current}`
              : "",
          ];
          const { value } = await withFallback((openai, rung) =>
            openai.responses.create({
              model: rung.model,
              store: false,
              max_output_tokens: Math.min(2000, serverEnv.openaiMaxOutputTokens),
              instructions: rules.filter(Boolean).join("\n"),
              input: [
                {
                  role: "user",
                  content: original
                    ? `From: ${original.from}\nSubject: ${original.subject}\nDate: ${original.date}\n\n${original.text.slice(0, 12_000)}`
                    : `Subject: ${subject || "(none yet)"}\nTo: ${str(body.to, 500) || "(not given)"}`,
                },
              ] as never,
            }),
          );
          let text = ((value as { output_text?: string }).output_text ?? "").trim();
          let suggested: string | undefined;
          const subjectLine = /^subject:\s*(.+)\n+/i.exec(text);
          if (subjectLine?.[1]) {
            suggested = subjectLine[1].trim();
            text = text.slice(subjectLine[0].length).trim();
          }
          if (!text) return json({ ok: false, message: "No draft came back. Try again." }, 502);
          return json({
            ok: true,
            text,
            subject: suggested,
            to: original ? senderName(original.from) : undefined,
          });
        } catch (error) {
          return json(
            { ok: false, message: error instanceof Error ? error.message : "Could not draft it." },
            502,
          );
        }
      },
    },
  },
});

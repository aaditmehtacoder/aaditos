// @vitest-environment node
import { describe, expect, it } from "vitest";

import { addressOf, buildReply, htmlToText, messageText } from "@/server/providers/gmail";

function decode(raw: string): string {
  const bytes = Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

function bodyOf(message: string): string {
  const b64 = message.split("\r\n\r\n")[1]?.replace(/\r\n/g, "") ?? "";
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

const b64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

describe("buildReply", () => {
  const base = {
    from: "me@gmail.com",
    to: "teacher@school.net",
    subject: "Field trip form",
    messageId: "<abc@mail.gmail.com>",
    references: "<root@mail.gmail.com>",
    body: "Thanks, I'll bring it Friday.",
  };

  it("threads onto the original and says Re: once", () => {
    const raw = decode(buildReply(base));
    expect(raw).toContain("To: teacher@school.net");
    expect(raw).toContain("Subject: Re: Field trip form");
    expect(raw).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(raw).toContain("References: <root@mail.gmail.com> <abc@mail.gmail.com>");
    expect(decode(buildReply({ ...base, subject: "RE: Field trip form" }))).toContain(
      "Subject: RE: Field trip form",
    );
  });

  it("cannot be talked into extra headers", () => {
    const raw = decode(
      buildReply({ ...base, subject: "Hi\r\nBcc: everyone@example.com", to: "a@b.c\nCc: x@y.z" }),
    );
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(raw).not.toMatch(/^Cc:/m);
  });

  it("carries any language in the body and the subject, and quotes the original", () => {
    const raw = decode(
      buildReply({
        ...base,
        subject: "Café 🎉",
        body: "¡Gracias! 谢谢",
        quote: { date: "Mon, 3 Nov 2026", from: "Ms. Patel", text: "Bring the form.\nThanks" },
      }),
    );
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
    const body = bodyOf(raw);
    expect(body).toContain("¡Gracias! 谢谢");
    expect(body).toContain("On Mon, 3 Nov 2026, Ms. Patel wrote:\n> Bring the form.\n> Thanks");
  });
});

describe("reading a message", () => {
  it("prefers the plain-text part and falls back to HTML turned into text", () => {
    expect(
      messageText({
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("Plain body") } },
          { mimeType: "text/html", body: { data: b64url("<b>HTML</b>") } },
        ],
      }),
    ).toBe("Plain body");
    expect(
      messageText({
        mimeType: "text/html",
        body: { data: b64url("<p>Hello&nbsp;there</p><script>alert(1)</script><p>Bye</p>") },
      }),
    ).toBe("Hello there\nBye");
  });

  it("drops scripts and styles from HTML mail entirely", () => {
    expect(htmlToText("<style>p{}</style><p>Hi</p><script>x()</script>")).toBe("Hi");
  });

  it("finds the address to reply to", () => {
    expect(addressOf('"Ms. Patel" <patel@scusd.net>')).toBe("patel@scusd.net");
    expect(addressOf("bare@x.org")).toBe("bare@x.org");
  });
});

describe("showing HTML mail safely", () => {
  it("strips everything that could run or reach out, and keeps the formatting", async () => {
    const { sanitizeEmailHtml } = await import("@/server/providers/gmail");
    const dirty = [
      '<p style="color:red"><b>Bold</b> and <i>italic</i></p>',
      "<script>alert(1)</script>",
      '<img src="x" onerror="alert(1)">',
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="https://ok.example">ok</a>',
      '<iframe src="https://evil.example"></iframe>',
      '<form action="https://evil.example"><input name="pw"></form>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<base href="https://evil.example/">',
      '<img src="cid:logo123">',
      "<!-- <script>hidden()</script> -->",
    ].join("");
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).toContain("<b>Bold</b>");
    expect(clean).toContain("<i>italic</i>");
    expect(clean).toContain('style="color:red"');
    expect(clean).not.toMatch(/<script|onerror|javascript:|<iframe|<form|<input|<meta|<base|cid:/i);
    expect(clean).toContain(
      '<a rel="noopener noreferrer" target="_blank" href="https://ok.example"',
    );
  });

  it("finds the HTML part of a message, sanitized", async () => {
    const { messageHtml } = await import("@/server/providers/gmail");
    expect(
      messageHtml({
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("*Bold*") } },
          { mimeType: "text/html", body: { data: b64url("<b>Bold</b><script>x()</script>") } },
        ],
      }),
    ).toBe("<b>Bold</b>");
    expect(messageHtml({ mimeType: "text/plain", body: { data: b64url("only text") } })).toBe("");
  });

  it("turns one-line-per-div HTML into single-spaced text, not double", () => {
    expect(htmlToText("<div>Cheers,<br></div><div>Revathi<br></div>")).toBe("Cheers,\nRevathi");
  });
});

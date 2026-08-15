/**
 * Email ingestion and the calendar write.
 *
 * The model call itself needs a real key, so what is tested here is everything
 * around it: MIME walking that must not return an attachment, HTML reduction
 * that must not lose a room number, the exclusive end date Google wants for an
 * all-day event, and the scope diff that decides whether the UI tells the user
 * to reconnect.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_QUERY, extractBody, htmlToText, normalizeMessage } from "@/server/providers/gmail";
import { calendarDate } from "@/server/providers/google";
import { missingScopes } from "@/routes/api.google.status";
import { weatherIcon } from "@/components/os/weather-glyph";

const b64 = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("DEFAULT_QUERY", () => {
  it("bounds the search by recency so it is never a whole-mailbox scan", () => {
    expect(DEFAULT_QUERY).toMatch(/newer_than:\d+d/);
  });

  it("excludes promotions and social, which carry no real deadlines", () => {
    expect(DEFAULT_QUERY).toContain("-category:promotions");
    expect(DEFAULT_QUERY).toContain("-category:social");
  });
});

describe("htmlToText", () => {
  it("keeps room numbers and times that sit inside markup", () => {
    const html = "<p>Meeting in <b>Room N102</b> at <strong>3:14 PM</strong></p>";
    expect(htmlToText(html)).toBe("Meeting in Room N102 at 3:14 PM");
  });

  it("turns list items into lines so two dates do not merge into one", () => {
    const text = htmlToText("<ul><li>Friday, August 14</li><li>Saturday, August 15</li></ul>");
    expect(text).toContain("Friday, August 14");
    expect(text).toContain("Saturday, August 15");
    expect(text).not.toMatch(/August 14\s*Saturday/);
  });

  it("drops script and style content rather than reading it as prose", () => {
    expect(htmlToText("<style>.a{color:red}</style><p>Hi</p>")).toBe("Hi");
    expect(htmlToText("<script>var x=1</script><p>Hi</p>")).toBe("Hi");
  });

  it("decodes the entities that appear in real club mail", () => {
    expect(htmlToText("<p>Setup &amp; takedown &#8212; 4&nbsp;PM</p>")).toContain(
      "Setup & takedown",
    );
  });
});

describe("extractBody", () => {
  it("prefers text/plain over the HTML alternative", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("plain wins") } },
        { mimeType: "text/html", body: { data: b64("<p>html loses</p>") } },
      ],
    });
    expect(body).toBe("plain wins");
  });

  it("falls back to reduced HTML when there is no plain part", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/html", body: { data: b64("<p>Room N102</p>") } }],
    });
    expect(body).toBe("Room N102");
  });

  it("never reads an attachment, even one claiming to be text", () => {
    const body = extractBody({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("real body") } },
        {
          mimeType: "text/plain",
          filename: "secrets.txt",
          body: { data: b64("ATTACHMENT CONTENT") },
        },
      ],
    });
    expect(body).toBe("real body");
    expect(body).not.toContain("ATTACHMENT");
  });

  it("finds a body nested several levels down", () => {
    const body = extractBody({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64("deep body") } }],
        },
      ],
    });
    expect(body).toBe("deep body");
  });

  it("returns an empty string rather than throwing on a missing payload", () => {
    expect(extractBody(undefined)).toBe("");
  });
});

describe("normalizeMessage", () => {
  const base = {
    id: "m1",
    threadId: "t1",
    internalDate: "1755129600000",
    payload: {
      headers: [
        { name: "Subject", value: "Welcome to WBE" },
        { name: "From", value: "Ananya B <ananyab@scusd.net>" },
      ],
      mimeType: "text/plain",
      body: { data: b64("First meeting Wednesday, August 19th in Room N102") },
    },
  };

  it("uses internalDate so relative wording resolves against the send time", () => {
    const message = normalizeMessage(base);
    expect(message?.receivedAt).toBe(new Date(1755129600000).toISOString());
  });

  it("keeps the body text that carries the dates", () => {
    expect(normalizeMessage(base)?.body).toContain("Room N102");
  });

  it("drops a message with neither subject nor body", () => {
    expect(normalizeMessage({ id: "m2", payload: { headers: [] } })).toBeNull();
  });

  it("labels a subject-less message rather than rendering a blank row", () => {
    const message = normalizeMessage({
      id: "m3",
      payload: { headers: [], mimeType: "text/plain", body: { data: b64("body only") } },
    });
    expect(message?.subject).toBe("(no subject)");
  });
});

describe("calendarDate", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // 07:00 UTC on the 15th is still 00:00 on the 15th in Pacific — but one
    // hour earlier it is still the 14th, which is the case that goes wrong.
    const lateEvening = new Date("2026-08-15T06:00:00Z");
    expect(calendarDate(lateEvening, "America/Los_Angeles")).toBe("2026-08-14");
  });

  it("formats as YYYY-MM-DD, which is what the Calendar API accepts", () => {
    expect(calendarDate(new Date("2026-08-19T20:00:00Z"), "America/Los_Angeles")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});

describe("missingScopes", () => {
  const ALL = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
    "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "email",
  ];

  it("reports nothing missing when every scope was granted", () => {
    expect(missingScopes(ALL)).toEqual([]);
  });

  /**
   * Google echoes `email` back as `userinfo.email`. Comparing raw strings marks
   * it missing on every connection, which would make the reconnect banner
   * permanent — the exact false positive this guards.
   */
  it("accepts userinfo.email as the granted form of email", () => {
    const granted = ALL.filter((s) => s !== "email").concat(
      "https://www.googleapis.com/auth/userinfo.email",
    );
    expect(missingScopes(granted)).toEqual([]);
  });

  it("reports a genuinely absent scope", () => {
    const granted = ALL.filter((s) => !s.includes("gmail"));
    expect(missingScopes(granted)).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });

  it("reports every capability an old consent predates", () => {
    const old = [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "openid",
    ];
    expect(missingScopes(old)).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(missingScopes(old)).toContain("https://www.googleapis.com/auth/gmail.readonly");
  });
});

describe("weatherIcon", () => {
  const name = (code: number | undefined, isDay = true) =>
    (weatherIcon(code, isDay) as unknown as { displayName?: string }).displayName;

  it("draws a moon for a clear night and a sun for a clear day", () => {
    expect(name(0, true)).toBe("Sun");
    expect(name(0, false)).toBe("Moon");
  });

  it("only varies by day and night when the sky is actually visible", () => {
    expect(name(61, true)).toBe(name(61, false));
    expect(name(95, true)).toBe(name(95, false));
  });

  it("draws precipitation rather than a sun", () => {
    expect(name(63)).toBe("CloudRain");
    expect(name(73)).toBe("CloudSnow");
    expect(name(53)).toBe("CloudDrizzle");
    expect(name(95)).toBe("CloudLightning");
    expect(name(45)).toBe("CloudFog");
  });

  /**
   * The failure that matters: an unmapped code must never fall through to a
   * sun, because a wrong weather icon is read as a fact about the weather.
   */
  it("never falls back to a sun for an unknown or missing code", () => {
    expect(name(undefined)).toBe("Cloud");
    expect(name(77)).not.toBe("Sun");
    expect(name(66)).not.toBe("Sun");
    expect(name(57)).not.toBe("Sun");
    expect(name(82)).not.toBe("Sun");
  });
});

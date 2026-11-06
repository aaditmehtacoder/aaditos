import { describe, expect, it } from "vitest";

import { groupThreads, listDate, splitQuoted, type MailSummary } from "@/lib/mail/api";

describe("splitQuoted", () => {
  it("folds history under a one-line header", () => {
    const { fresh, quoted } = splitQuoted(
      "Sounds good!\n\nOn Tue, Nov 3, 2026 Jane <j@x.org> wrote:\n> Lunch?",
    );
    expect(fresh).toBe("Sounds good!");
    expect(quoted).toMatch(/^On Tue/);
  });

  it("folds history when the header wraps onto two lines", () => {
    const { fresh, quoted } = splitQuoted(
      "Hope you can join us!\n\nOn Tue, Nov 3, 2026 at 3:51 AM Bridget Carl <\nbridget@x.com> wrote:\n> Hi",
    );
    expect(fresh).toBe("Hope you can join us!");
    expect(quoted.startsWith("On Tue")).toBe(true);
  });

  it("folds Zoho's '---- on … wrote ----' history", () => {
    const { fresh, quoted } = splitQuoted(
      'Cheers,\nRevathi\n\n---- on Wed, 04 Nov 2026 22:01:30 +0530 "Team" <mailto:t@x.com> wrote ----\n\nHi team',
    );
    expect(fresh).toBe("Cheers,\nRevathi");
    expect(quoted).toMatch(/^---- on Wed/);
  });

  it("leaves a message with no history alone", () => {
    expect(splitQuoted("Just this.")).toEqual({ fresh: "Just this.", quoted: "" });
  });
});

describe("groupThreads", () => {
  const msg = (id: string, threadId: string, date: string, unread = false): MailSummary => ({
    id,
    threadId,
    account: "a@gmail.com",
    from: id,
    fromAddress: `${id}@x.org`,
    to: "",
    subject: "s",
    snippet: "",
    date,
    unread,
    starred: false,
    important: false,
    inInbox: true,
    draft: false,
  });

  it("shows one row per conversation: the newest message, unread if any is", () => {
    const rows = groupThreads([
      msg("old", "t1", "2026-11-01T00:00:00Z", true),
      msg("new", "t1", "2026-11-03T00:00:00Z"),
      msg("other", "t2", "2026-11-02T00:00:00Z"),
    ]);
    expect(rows.map((r) => [r.from, r.count, r.unread])).toEqual([
      ["new", 2, true],
      ["other", 1, false],
    ]);
  });
});

describe("listDate", () => {
  const now = new Date("2026-11-05T20:00:00");
  it("shows a time today, a month and day this year, and a short date before that", () => {
    expect(listDate("2026-11-05T09:30:00", now)).toMatch(/9:30/);
    expect(listDate("2026-03-02T09:30:00", now)).toBe("Mar 2");
    expect(listDate("2025-03-02T09:30:00", now)).toBe("3/2/25");
  });
});

import { describe, expect, it } from "vitest";

import { TaskDraftSchema, parseTaskInput } from "@/lib/core/nl-task";
import { APP_TZ, zonedParts, zonedToUtc } from "@/lib/core/time";

// Wednesday 12 August 2026, 7:42 AM Pacific.
const NOW = zonedToUtc(2026, 8, 12, 7, 42, APP_TZ);
const ctx = {
  now: NOW,
  courses: ["Algebra 2", "English 9 Honors", "Spanish 1", "Biology"],
  projects: ["Venu AI", "Pick44", "Origami Prep", "OpenRubric"],
};

describe("parseTaskInput", () => {
  it("parses the canonical example end to end", () => {
    const draft = parseTaskInput("Finish Algebra 2 worksheet tomorrow at 6 PM for 30 minutes", ctx);
    expect(draft.title).toBe("Finish Algebra 2 worksheet");
    expect(draft.estimateMin).toBe(30);
    expect(draft.courseName).toBe("Algebra 2");
    expect(draft.category).toBe("school");
    expect(draft.dueAllDay).toBe(false);

    const due = zonedParts(draft.dueAt!, APP_TZ);
    expect(due).toMatchObject({ year: 2026, month: 8, day: 13, hour: 18, minute: 0 });
  });

  it("always returns a schema-valid draft", () => {
    for (const input of [
      "",
      "x",
      "Do the thing",
      "!!!",
      "Read 300 pages for 900 minutes tomorrow",
      "meet at 25:99 pm",
    ]) {
      expect(TaskDraftSchema.safeParse(parseTaskInput(input, ctx)).success).toBe(true);
    }
  });

  it("understands hours as well as minutes", () => {
    expect(parseTaskInput("Study biology for 2 hours", ctx).estimateMin).toBe(120);
    expect(parseTaskInput("Quick review for 1.5 hrs", ctx).estimateMin).toBe(90);
  });

  it("defaults to 30 minutes when no duration is given", () => {
    expect(parseTaskInput("Email Jeremy", ctx).estimateMin).toBe(30);
  });

  it("resolves 'today' and 'tonight' to the current date", () => {
    const draft = parseTaskInput("Turn in the form today", ctx);
    expect(zonedParts(draft.dueAt!, APP_TZ)).toMatchObject({ year: 2026, month: 8, day: 12 });
    expect(draft.dueAllDay).toBe(true);
  });

  it("resolves a weekday to the next occurrence", () => {
    // Wed 12 Aug -> Friday is the 14th.
    const draft = parseTaskInput("Send the one-pager friday", ctx);
    expect(zonedParts(draft.dueAt!, APP_TZ).day).toBe(14);
  });

  it("resolves 'next <weekday>' a week further out", () => {
    const draft = parseTaskInput("Ship it next friday", ctx);
    expect(zonedParts(draft.dueAt!, APP_TZ).day).toBe(21);
  });

  it("resolves explicit month and day", () => {
    const draft = parseTaskInput("Register for hackUMBC Sep 12", ctx);
    expect(zonedParts(draft.dueAt!, APP_TZ)).toMatchObject({ month: 9, day: 12, year: 2026 });
  });

  it("rolls a bare past time forward to tomorrow", () => {
    // 6 AM has already passed at 7:42 AM.
    const draft = parseTaskInput("Standup at 6 AM", ctx);
    expect(zonedParts(draft.dueAt!, APP_TZ).day).toBe(13);
  });

  it("detects priority words", () => {
    expect(parseTaskInput("urgent: fix the build", ctx).priority).toBe("urgent");
    expect(parseTaskInput("important: call Jeremy", ctx).priority).toBe("high");
    expect(parseTaskInput("someday learn Rust", ctx).priority).toBe("low");
  });

  it("infers urgency from a very near deadline", () => {
    expect(parseTaskInput("Submit the form today at 9 AM", ctx).priority).toBe("high");
  });

  it("prefers a course when one matches", () => {
    const draft = parseTaskInput("Biology lab writeup", ctx);
    expect(draft.courseName).toBe("Biology");
  });

  it("falls back to personal for everyday text", () => {
    expect(parseTaskInput("Pack PE clothes", ctx).category).toBe("personal");
  });

  it("strips every parsed fragment out of the title", () => {
    const draft = parseTaskInput("urgent: Draft the recap tomorrow at 4 PM for 45 min", ctx);
    expect(draft.title.toLowerCase()).not.toContain("tomorrow");
    expect(draft.title.toLowerCase()).not.toContain("4 pm");
    expect(draft.title.toLowerCase()).not.toContain("45 min");
    expect(draft.title).toContain("Draft the recap");
  });

  it("never produces an empty title", () => {
    expect(parseTaskInput("tomorrow", ctx).title.length).toBeGreaterThan(0);
  });

  it("leaves the due date unset when the text has no date or time", () => {
    expect(parseTaskInput("Read one chapter", ctx).dueAt).toBeUndefined();
  });
});

describe("TaskDraftSchema", () => {
  it("rejects an out-of-range estimate", () => {
    const base = parseTaskInput("Do a thing", ctx);
    expect(TaskDraftSchema.safeParse({ ...base, estimateMin: 4 }).success).toBe(false);
    expect(TaskDraftSchema.safeParse({ ...base, estimateMin: 601 }).success).toBe(false);
  });

  it("rejects an unknown category or priority", () => {
    const base = parseTaskInput("Do a thing", ctx);
    expect(TaskDraftSchema.safeParse({ ...base, category: "chores" }).success).toBe(false);
    expect(TaskDraftSchema.safeParse({ ...base, priority: "critical" }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    const base = parseTaskInput("Do a thing", ctx);
    expect(TaskDraftSchema.safeParse({ ...base, title: "" }).success).toBe(false);
  });
});

/**
 * The new provider adapters, at their pure seams.
 *
 * Each normalizer turns an outside API's rows into the app's own shapes. They
 * are tested on fixtures shaped like the real responses so a renamed field on
 * their side fails here, not silently as an empty Inbox.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeAeriesAssignments, normalizeAeriesClasses } from "@/server/providers/aeries";
import { normalizeGithubItems } from "@/server/providers/github";
import { GMAIL_SCOPE, normalizeGmailMessages, senderName } from "@/server/providers/gmail";
import { GOOGLE_SCOPES, buildConsentUrl } from "@/server/providers/google";
import { normalizeNotionPages, normalizeNotionTasks } from "@/server/providers/notion";
import { normalizeSlackMatches } from "@/server/providers/slack";

const NOW = "2026-10-19T20:00:00.000Z";

describe("GitHub", () => {
  it("labels issues and pull requests and keeps the repository", () => {
    const items = normalizeGithubItems(
      [
        {
          id: 1,
          number: 12,
          title: "Fix the login redirect",
          html_url: "https://github.com/a/b/issues/12",
          updated_at: NOW,
          body: "Steps:\n1. go\n2. click",
          repository_url: "https://api.github.com/repos/a/b",
          user: { login: "teammate" },
        },
        {
          id: 2,
          number: 13,
          title: "Add dark mode",
          html_url: "https://github.com/a/b/pull/13",
          updated_at: NOW,
          repository_url: "https://api.github.com/repos/a/b",
          pull_request: {},
        },
        { id: 3, title: "" },
      ],
      "Assigned to you",
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("Issue #12 Fix the login redirect");
    expect(items[0]?.detail).toContain("a/b");
    expect(items[0]?.detail).toContain("Steps: 1. go 2. click");
    expect(items[0]?.from).toBe("teammate");
    expect(items[1]?.title).toBe("PR #13 Add dark mode");
    expect(items.every((i) => i.source === "github")).toBe(true);
  });
});

describe("Slack", () => {
  it("drops the user's own messages and names the channel", () => {
    const items = normalizeSlackMatches(
      [
        {
          ts: "1760900000.000100",
          text: "<@U1> can you look at the deck?",
          permalink: "https://x.slack.com/p1",
          username: "sam",
          user: "U2",
          channel: { id: "C1", name: "robotics" },
        },
        { ts: "1760900001.000100", text: "sure", user: "U1", channel: { id: "C1" } },
        { ts: "1760900002.000100", text: "hey", user: "U3", channel: { id: "D1", is_im: true } },
      ],
      "U1",
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("@you can you look at the deck?");
    expect(items[0]?.detail).toBe("#robotics");
    expect(items[1]?.detail).toBe("DM");
    expect(items[0]?.at).toBe(new Date(1760900000 * 1000).toISOString());
  });
});

describe("Notion", () => {
  it("keeps pages edited within the window and reads the title property", () => {
    const now = new Date(NOW);
    const items = normalizeNotionPages(
      [
        {
          id: "p1",
          object: "page",
          url: "https://notion.so/p1",
          last_edited_time: new Date(now.getTime() - 86_400_000).toISOString(),
          properties: { Name: { type: "title", title: [{ plain_text: "Bio lab plan" }] } },
        },
        {
          id: "p2",
          object: "page",
          last_edited_time: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
          properties: { Name: { type: "title", title: [{ plain_text: "Old" }] } },
        },
        {
          id: "p3",
          object: "page",
          archived: true,
          last_edited_time: NOW,
          title: [{ plain_text: "x" }],
        },
      ],
      now,
    );
    expect(items.map((i) => i.title)).toEqual(["Bio lab plan"]);
  });

  it("skips rows that are done by checkbox or status", () => {
    const items = normalizeNotionTasks([
      {
        id: "t1",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Email Mr. Honer" }] },
          Done: { type: "checkbox", checkbox: false },
          Due: { type: "date", date: { start: "2026-10-21" } },
        },
      },
      {
        id: "t2",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Finished thing" }] },
          Status: { type: "status", status: { name: "Done" } },
        },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toBe("Due 2026-10-21");
  });
});

describe("Gmail", () => {
  it("reads subject, sender and snippet from metadata headers", () => {
    const items = normalizeGmailMessages([
      {
        id: "m1",
        threadId: "t1",
        snippet: "Reminder:   the field trip  form is due Friday",
        internalDate: "1760900000000",
        payload: {
          headers: [
            { name: "Subject", value: "Field trip" },
            { name: "From", value: '"Ms. Patel" <patel@scusd.net>' },
          ],
        },
      },
      { id: "m2", payload: { headers: [] } },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("Field trip");
    expect(items[0]?.from).toBe("Ms. Patel");
    expect(items[0]?.detail).toBe("Reminder: the field trip form is due Friday");
    expect(items[0]?.url).toContain("t1");
    expect(items[1]?.title).toBe("(no subject)");
  });

  it("parses sender names", () => {
    expect(senderName("Jane Doe <jane@x.org>")).toBe("Jane Doe");
    expect(senderName("jane@x.org")).toBe("jane@x.org");
  });

  it("is read-only and opt-in: not in the base scopes, added only when asked", () => {
    expect(GMAIL_SCOPE).toMatch(/readonly$/);
    expect(GOOGLE_SCOPES).not.toContain(GMAIL_SCOPE);
    const base = buildConsentUrl({ redirectUri: "https://x/cb", state: "s" });
    const withGmail = buildConsentUrl({
      redirectUri: "https://x/cb",
      state: "s",
      extraScopes: [GMAIL_SCOPE],
    });
    expect(decodeURIComponent(base)).not.toContain("gmail");
    expect(decodeURIComponent(withGmail)).toContain(GMAIL_SCOPE);
  });
});

describe("Aeries", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    process.env["AERIES_BASE_URL"] = "https://aeries.example.org";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("turns class rows into courses with teacher, period and current mark", () => {
    const courses = normalizeAeriesClasses(
      [
        {
          SectionNumber: 101,
          CourseTitle: "Algebra 2",
          TeacherName: "Honer",
          Period: 3,
          Room: "B12",
          CurrentMark: "A-",
        },
        { SectionNumber: 102, CourseTitle: "" },
      ],
      "u1",
      NOW,
    );
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      name: "Algebra 2",
      teacher: "Honer",
      period: 3,
      room: "B12",
      grade: "A-",
      source: "aeries",
      sourceRef: "aeries:section:101",
    });
    // Same input, same id: a re-sync updates instead of duplicating.
    expect(
      normalizeAeriesClasses([{ SectionNumber: 101, CourseTitle: "Algebra 2" }], "u1", NOW)[0]?.id,
    ).toBe(courses[0]?.id);
  });

  it("marks graded, missing and open assignments", () => {
    const assignments = normalizeAeriesAssignments(
      [
        {
          AssignmentNumber: 1,
          Description: "Quiz 3",
          DueDate: "2026-10-10",
          NumberPossible: 20,
          Score: 18,
        },
        {
          AssignmentNumber: 2,
          Description: "Packet",
          DueDate: "2026-10-12",
          NumberPossible: 10,
          IsMissing: true,
        },
        { AssignmentNumber: 3, Description: "Project", DueDate: "2026-11-01", NumberPossible: 50 },
      ],
      { userId: "u1", now: NOW, gradebook: "77", courseId: "c1" },
    );
    expect(assignments.map((a) => a.state)).toEqual(["graded", "missing", "assigned"]);
    expect(assignments[0]?.grade).toBe("18/20");
    expect(assignments.every((a) => a.courseId === "c1")).toBe(true);
  });
});

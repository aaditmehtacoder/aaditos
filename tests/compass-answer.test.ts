import { describe, expect, it } from "vitest";

import { parseAnswer } from "@/components/os/compass-answer";

describe("parseAnswer", () => {
  it("keeps a plain line as one paragraph", () => {
    expect(parseAnswer("You have 3 tasks today.")).toEqual([
      { kind: "p", lines: ["You have 3 tasks today."] },
    ]);
  });

  it("groups consecutive bullets into one list", () => {
    expect(parseAnswer("- Algebra worksheet\n- Bio contract")).toEqual([
      { kind: "ul", items: ["Algebra worksheet", "Bio contract"] },
    ]);
  });

  it("groups numbered lines into an ordered list", () => {
    expect(parseAnswer("1. First\n2) Second")).toEqual([
      { kind: "ol", items: ["First", "Second"] },
    ]);
  });

  it("separates a paragraph from a following list", () => {
    expect(parseAnswer("Due soon:\n- Essay")).toEqual([
      { kind: "p", lines: ["Due soon:"] },
      { kind: "ul", items: ["Essay"] },
    ]);
  });

  it("starts a new paragraph after a blank line", () => {
    expect(parseAnswer("One.\n\nTwo.")).toEqual([
      { kind: "p", lines: ["One."] },
      { kind: "p", lines: ["Two."] },
    ]);
  });

  it("drops empty blocks rather than rendering blank nodes", () => {
    expect(parseAnswer("\n\n   \n")).toEqual([]);
  });

  it("leaves inline markers intact for the inline renderer", () => {
    expect(parseAnswer("- **Bio lab** — due `Friday`")).toEqual([
      { kind: "ul", items: ["**Bio lab** — due `Friday`"] },
    ]);
  });
});

describe("parseAnswer, the rest of markdown", () => {
  it("reads headings, and caps them below the page title", () => {
    expect(parseAnswer("# Plan\n### Steps")).toEqual([
      { kind: "h", level: 1, text: "Plan" },
      { kind: "h", level: 3, text: "Steps" },
    ]);
  });

  it("keeps a fenced block verbatim, with its language", () => {
    expect(parseAnswer("```ts\nconst a = 1;\n\n- not a bullet\n```\nafter")).toEqual([
      { kind: "code", lang: "ts", lines: ["const a = 1;", "", "- not a bullet"] },
      { kind: "p", lines: ["after"] },
    ]);
  });

  it("treats an unterminated fence as code to the end, so streaming never flickers", () => {
    expect(parseAnswer("```py\nprint(1)")).toEqual([
      { kind: "code", lang: "py", lines: ["print(1)"] },
    ]);
  });

  it("reads a table", () => {
    expect(parseAnswer("| Class | Due |\n|---|---|\n| Bio | Fri |\n| Math | Mon |")).toEqual([
      {
        kind: "table",
        header: ["Class", "Due"],
        rows: [
          ["Bio", "Fri"],
          ["Math", "Mon"],
        ],
      },
    ]);
  });

  it("reads quotes and rules, and does not mistake a bullet for a rule", () => {
    expect(parseAnswer("> said\n> this\n---\n- item")).toEqual([
      { kind: "quote", lines: ["said", "this"] },
      { kind: "hr" },
      { kind: "ul", items: ["item"] },
    ]);
  });
});

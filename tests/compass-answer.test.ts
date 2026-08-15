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

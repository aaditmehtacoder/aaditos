import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/os/markdown";
import { prepareMarkdown } from "@/lib/markdown/prepare";

describe("prepareMarkdown", () => {
  it("turns \\( \\) into inline maths", () => {
    expect(prepareMarkdown("So \\( \\frac{3}{4} \\) of it.")).toBe("So $$\\frac{3}{4}$$ of it.");
  });

  it("turns \\[ \\] on its own lines into a display block, keeping list indentation", () => {
    expect(prepareMarkdown("1. Add:\n   \\[\n   x = 1\n   \\]")).toBe(
      "1. Add:\n   $$\n   x = 1\n   $$",
    );
  });

  it("sets \\[ \\] inside a sentence in display style without breaking the line", () => {
    expect(prepareMarkdown("Then \\[x^2\\] works.")).toBe("Then $$\\displaystyle x^2$$ works.");
  });

  it("keeps single-dollar maths that passes Pandoc's rule", () => {
    expect(prepareMarkdown("Let $x^2 + 1$ be")).toBe("Let $$x^2 + 1$$ be");
  });

  it("keeps prices as prices", () => {
    expect(prepareMarkdown("It costs $5 and $10.")).toBe("It costs \\$5 and \\$10.");
    expect(prepareMarkdown("From $5-$10 a month")).toBe("From \\$5-\\$10 a month");
  });

  it("never touches code", () => {
    const code = "```js\nconst a = `$x$`; // \\(y\\)\n```";
    expect(prepareMarkdown(code)).toBe(code);
    expect(prepareMarkdown("Run `echo $HOME` now")).toBe("Run `echo $HOME` now");
  });

  it("leaves an unclosed delimiter alone while it is still streaming", () => {
    expect(prepareMarkdown("Area is \\( \\frac{1")).toBe("Area is \\( \\frac{1");
    expect(prepareMarkdown("$$\n\\int_0^1")).toBe("$$\n\\int_0^1");
  });

  it("drops the brackets around a web-search citation", () => {
    expect(prepareMarkdown("It rained ([apnews.com](https://apnews.com/a)).")).toBe(
      "It rained [apnews.com](https://apnews.com/a).",
    );
  });
});

describe("<Markdown>", () => {
  it("renders a fraction with KaTeX, stacked, not as a slash", () => {
    const { container } = render(<Markdown text={"Half is \\( \\frac{1}{2} \\)."} />);
    expect(container.querySelector(".katex .mfrac")).not.toBeNull();
    // The visible layer; the MathML copy keeps the source for screen readers.
    expect(container.querySelector(".katex-html")?.textContent).not.toContain("\\frac");
  });

  it("renders display maths as a block", () => {
    const { container } = render(<Markdown text={"\\[\n\\sqrt{x} = \\frac{a}{b}\n\\]"} />);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("renders dollar maths, and a bare $$x$$ line, as inline maths without eating the text after it", () => {
    const { container } = render(<Markdown text={"$x$\n\nAfter."} />);
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).toContain("After.");
  });

  it("does not turn prices into maths", () => {
    const { container } = render(<Markdown text="Tickets are $5 and $10." />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$5 and $10");
  });

  it("renders a table with a header and body", () => {
    const { container } = render(
      <Markdown text={"| Fraction | Decimal |\n| --- | ---: |\n| \\(\\frac{1}{4}\\) | 0.25 |"} />,
    );
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelector("td .katex")).not.toBeNull();
    expect(container.querySelector(".md-table")).not.toBeNull();
  });

  it("turns a <br> in a table cell into a line break and shows other HTML as text", () => {
    const { container } = render(
      <Markdown text={"| a |\n| - |\n| one<br>two |\n\n<script>alert(1)</script>"} />,
    );
    expect(container.querySelector("td br")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("highlights fenced code and labels the language", () => {
    const { container } = render(<Markdown text={"```python\nprint('hi')\n```"} />);
    expect(container.querySelector(".md-code-head")?.textContent).toContain("python");
    expect(container.querySelector("code.hljs")).not.toBeNull();
  });

  it("renders nested lists, task lists and strikethrough", () => {
    const { container } = render(
      <Markdown text={"- one\n  - two\n- [x] done\n- [ ] todo\n\n~~gone~~"} />,
    );
    expect(container.querySelector("ul ul")).not.toBeNull();
    expect(container.querySelectorAll("input[type=checkbox]")).toHaveLength(2);
    expect(container.querySelector("del")).not.toBeNull();
  });

  it("shows https pictures and drops anything else", () => {
    const { container } = render(
      <Markdown
        text={
          "![A cat](https://upload.wikimedia.org/cat.jpg) ![x](javascript:alert(1)) ![y](http://a.b/c.png)"
        }
      />,
    );
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("src")).toBe("https://upload.wikimedia.org/cat.jpg");
  });

  it("opens links in a new tab and never renders a javascript: link", () => {
    const { container } = render(
      <Markdown text={"[ok](https://example.com) [bad](javascript:alert(1))"} />,
    );
    const links = [...container.querySelectorAll("a")];
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links.some((a) => (a.getAttribute("href") ?? "").startsWith("javascript"))).toBe(false);
  });

  it("renders the function-table answer that showed raw \\( \\) on the old renderer", () => {
    const text = [
      "**Function Table Question**",
      "",
      "A bike rental shop charges a $6 starting fee plus $4 for each hour rented.",
      "",
      "Let \\(h\\) be the number of hours and \\(C(h)\\) be the total cost.",
      "",
      "1. Write a function rule for \\(C(h)\\).",
      "2. Complete the table.",
      "",
      "| Hours, \\(h\\) | 0 | 1 | 3 |",
      "| --- | --- | --- | --- |",
      "| Total cost, \\(C(h)\\) | | | |",
    ].join("\n");
    const { container } = render(<Markdown text={text} />);
    const visible = [...container.querySelectorAll(".md p, .md li, .md th, .md td")]
      .map((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(".katex-mathml").forEach((m) => m.remove());
        return copy.textContent ?? "";
      })
      .join(" ");
    expect(visible).not.toMatch(/\\\(|\\\)/);
    expect(visible).toContain("$6 starting fee plus $4");
    expect(container.querySelectorAll("th .katex, td .katex, li .katex, p .katex").length).toBe(5);
    expect(container.querySelector(".md-table table")).not.toBeNull();
  });

  it("keeps single newlines as line breaks", () => {
    const { container } = render(<Markdown text={"Roses are red\nViolets are blue"} />);
    expect(container.querySelector("p br")).not.toBeNull();
  });
});

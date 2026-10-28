/**
 * Renders a Compass answer.
 *
 * The model replies in markdown. Showing that raw leaves literal `**` and
 * ``` in the UI, so this converts the subset it actually uses — paragraphs,
 * headings, bullet and numbered lists, fenced code, tables, quotes, rules,
 * and inline bold, italic, code, strikethrough and links — into elements.
 *
 * Deliberately not a general markdown engine: it parses a fixed grammar and
 * only ever emits React elements, so page content can never inject markup.
 * A link is only a link when it is http(s); anything else is left as text.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Splits inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` and `[text](url)` into elements. */
const INLINE =
  /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-secondary px-1 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      return <s key={i}>{part.slice(2, -2)}</s>;
    }
    const link = LINK.exec(part);
    if (link?.[1] && link[2]) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {link[1]}
        </a>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "hr" }
  | { kind: "table"; header: string[]; rows: string[][] };

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s{0,3}```\s*([\w+-]*)\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Groups raw lines into blocks. */
export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const last = blocks[blocks.length - 1];

    // A fence runs to the closing fence, or to the end while still streaming.
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s{0,3}```\s*$/.test(lines[j] ?? "")) {
        code.push(lines[j] ?? "");
        j += 1;
      }
      blocks.push({ kind: "code", lang: fence[1] ?? "", lines: code });
      i = j;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
      continue;
    }

    if (RULE.test(line) && !BULLET.test(line)) {
      blocks.push({ kind: "hr" });
      continue;
    }

    const next = lines[i + 1] ?? "";
    if (line.includes("|") && TABLE_SEPARATOR.test(next) && splitRow(line).length > 1) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && (lines[j] ?? "").includes("|")) {
        rows.push(splitRow(lines[j] ?? ""));
        j += 1;
      }
      blocks.push({ kind: "table", header, rows });
      i = j - 1;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote && quote[1] !== undefined) {
      if (last?.kind === "quote") last.lines.push(quote[1]);
      else blocks.push({ kind: "quote", lines: [quote[1]] });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);

    if (bullet?.[1] !== undefined) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else if (numbered?.[1] !== undefined) {
      if (last?.kind === "ol") last.items.push(numbered[1]);
      else blocks.push({ kind: "ol", items: [numbered[1]] });
    } else if (line.trim() === "") {
      // A blank line ends the current block.
      if (last) blocks.push({ kind: "p", lines: [] });
    } else if (last?.kind === "p" && last.lines.length > 0) {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }

  return blocks.filter((b) => {
    if (b.kind === "p") return b.lines.length > 0;
    if (b.kind === "ul" || b.kind === "ol") return b.items.length > 0;
    if (b.kind === "quote") return b.lines.some((l) => l.trim());
    return true;
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-[17px] font-semibold tracking-tight",
  2: "text-[15px] font-semibold tracking-tight",
  3: "text-[14px] font-semibold",
};

export function CompassAnswer({ text, className }: { text: string; className?: string }) {
  const blocks = parseAnswer(text);

  return (
    <div className={cn("space-y-2.5 leading-relaxed", className)}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-4.5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-4.5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case "h": {
            const level = Math.min(3, block.level);
            const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
            return (
              <Tag key={i} className={cn("pt-1", HEADING_CLASS[level])}>
                {renderInline(block.text)}
              </Tag>
            );
          }
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-[10px] border border-border bg-secondary/60 px-3 py-2.5 font-mono text-[12px] leading-[1.55]"
                data-lang={block.lang || undefined}
              >
                <code>{block.lines.join("\n")}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border pl-3 text-muted-foreground">
                {renderInline(block.lines.join("\n"))}
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="border-border" />;
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {block.header.map((cell, j) => (
                        <th
                          key={j}
                          className="border-b border-border px-2 py-1.5 text-left font-semibold"
                        >
                          {renderInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {block.header.map((_, c) => (
                          <td key={c} className="border-b border-border/60 px-2 py-1.5 align-top">
                            {renderInline(row[c] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={i}>{renderInline(block.lines.join("\n"))}</p>;
        }
      })}
    </div>
  );
}

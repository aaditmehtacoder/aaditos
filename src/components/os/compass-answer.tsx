/**
 * Renders an Compass answer.
 *
 * The model replies in light markdown (bold, italics, inline code, and simple
 * bullet or numbered lists). Showing that raw leaves literal `**` in the UI, so
 * this converts the small subset Compass actually uses into real elements.
 *
 * Deliberately not a general markdown engine: it parses a fixed grammar and
 * only ever emits React elements, so page content can never inject markup.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Splits inline `**bold**`, `*italic*` and `` `code` `` into elements. */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

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
        <code key={i} className="rounded bg-secondary px-1 text-[0.95em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** Groups raw lines into paragraphs and lists. */
export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];

  for (const line of text.split("\n")) {
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const last = blocks[blocks.length - 1];

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

  return blocks.filter((b) => (b.kind === "p" ? b.lines.length > 0 : b.items.length > 0));
}

export function CompassAnswer({ text, className }: { text: string; className?: string }) {
  const blocks = parseAnswer(text);

  return (
    <div className={cn("space-y-2 leading-relaxed", className)}>
      {blocks.map((block, i) => {
        if (block.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4.5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-4.5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{renderInline(block.lines.join("\n"))}</p>;
      })}
    </div>
  );
}

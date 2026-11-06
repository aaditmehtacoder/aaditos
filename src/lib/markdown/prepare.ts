/**
 * Gets a model's markdown ready for the renderer.
 *
 * Models write maths four ways: `\( … \)`, `\[ … \]`, `$ … $` and `$$ … $$`.
 * The renderer (remark-math) only knows dollars, and on its own it reads any
 * pair of single dollars as maths, so "$5 and $10" would become an equation.
 * This pass:
 *
 *   - turns `\[ … \]` on its own lines into a display block, and anywhere else
 *     into inline maths set in display style;
 *   - turns `\( … \)` into inline maths;
 *   - keeps `$ … $` as maths only when it passes Pandoc's test (no space just
 *     inside either dollar, no digit straight after the closing one) and
 *     escapes every other single dollar, so prices stay prices;
 *   - leaves `$$ … $$` alone, since remark-math already reads it correctly;
 *   - never touches code: fenced blocks and `inline` spans pass through as
 *     written.
 *
 * Inline maths comes out as `$$…$$` inside the line, which remark-math reads
 * as inline; the renderer switches single-dollar maths off.
 *
 * Plain text in, plain text out, so it is safe to run on every streamed
 * delta: an unclosed delimiter is left as it is until its partner arrives.
 */

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})/;

/** Splits text into alternating prose and fenced-code pieces. */
function splitFences(text: string): Array<{ code: boolean; text: string }> {
  const lines = text.split("\n");
  const pieces: Array<{ code: boolean; text: string }> = [];
  let prose: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const open = FENCE_OPEN.exec(line);
    if (!open) {
      prose.push(line);
      i += 1;
      continue;
    }
    const marker = open[2] ?? "```";
    const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    const code = [line];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j] ?? "")) {
      code.push(lines[j] ?? "");
      j += 1;
    }
    if (j < lines.length) code.push(lines[j] ?? "");
    if (prose.length > 0) pieces.push({ code: false, text: prose.join("\n") });
    prose = [];
    pieces.push({ code: true, text: code.join("\n") });
    i = j + 1;
  }
  if (prose.length > 0) pieces.push({ code: false, text: prose.join("\n") });
  return pieces;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/** Where a single-dollar span that opens at `start` closes, by Pandoc's rule, or -1. */
function closingDollar(s: string, start: number): number {
  if (isSpace(s[start + 1]) || s[start + 1] === "$") return -1;
  for (let j = start + 1; j < s.length; j += 1) {
    const c = s[j];
    if (c === "\n") return -1;
    if (c === "\\") {
      j += 1;
      continue;
    }
    if (c === "$") {
      if (isSpace(s[j - 1]) || isDigit(s[j + 1]) || s[j + 1] === "$") continue;
      return j;
    }
  }
  return -1;
}

/** Only spaces or tabs between `from` and the start of its line. */
function lineStartsAt(s: string, from: number): { ok: boolean; indent: string } {
  let k = from - 1;
  while (k >= 0 && (s[k] === " " || s[k] === "\t")) k -= 1;
  if (k >= 0 && s[k] !== "\n") return { ok: false, indent: "" };
  return { ok: true, indent: s.slice(k + 1, from) };
}

/** Only spaces or tabs between `from` and the end of its line. */
function lineEndsAt(s: string, from: number): boolean {
  let k = from;
  while (k < s.length && (s[k] === " " || s[k] === "\t")) k += 1;
  return k >= s.length || s[k] === "\n";
}

/** Rewrites the maths in one prose piece. */
function prepareProse(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];

    // Inline code: copied through untouched, however many backticks open it.
    if (c === "`") {
      let n = 1;
      while (s[i + n] === "`") n += 1;
      const run = "`".repeat(n);
      let search = i + n;
      let end = -1;
      while (search < s.length) {
        const found = s.indexOf(run, search);
        if (found === -1) break;
        if (s[found + n] !== "`" && s[found - 1] !== "`") {
          end = found;
          break;
        }
        search = found + 1;
      }
      if (end === -1) {
        out += run;
        i += n;
      } else {
        out += s.slice(i, end + n);
        i = end + n;
      }
      continue;
    }

    if (c === "\\") {
      const next = s[i + 1];
      if (next === "[") {
        const end = s.indexOf("\\]", i + 2);
        if (end === -1) {
          out += s.slice(i);
          break;
        }
        const body = s.slice(i + 2, end).trim();
        const start = lineStartsAt(s, i);
        if (start.ok && lineEndsAt(s, end + 2)) {
          // Already at the start of the line: the indent is in `out`.
          out += `$$\n${start.indent}${body}\n${start.indent}$$`;
        } else {
          out += `$$\\displaystyle ${body}$$`;
        }
        i = end + 2;
        continue;
      }
      if (next === "(") {
        const end = s.indexOf("\\)", i + 2);
        if (end === -1) {
          out += s.slice(i);
          break;
        }
        out += `$$${s.slice(i + 2, end).trim()}$$`;
        i = end + 2;
        continue;
      }
      // Any other escape, \$ included, stays exactly as written.
      out += s.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (c === "$") {
      if (s[i + 1] === "$") {
        const end = s.indexOf("$$", i + 2);
        if (end === -1) {
          out += s.slice(i);
          break;
        }
        out += s.slice(i, end + 2);
        i = end + 2;
        continue;
      }
      const end = closingDollar(s, i);
      if (end === -1) {
        out += "\\$";
        i += 1;
        continue;
      }
      out += `$$${s.slice(i + 1, end)}$$`;
      i = end + 1;
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

/**
 * Web-search answers cite as "([site.com](https://…))". The brackets around
 * the link are noise once the link renders as a source chip.
 */
const BRACKETED_SOURCE = /\(\[((?:www\.)?(?:[\w-]+\.)+[a-z]{2,})\]\((https?:\/\/[^\s)]+)\)\)/gi;

export function prepareMarkdown(text: string): string {
  return splitFences(text.replace(/\r\n?/g, "\n"))
    .map((piece) =>
      piece.code ? piece.text : prepareProse(piece.text.replace(BRACKETED_SOURCE, "[$1]($2)")),
    )
    .join("\n");
}

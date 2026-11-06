/**
 * Renders an assistant answer the way a chat app does.
 *
 * Full GitHub-flavoured markdown — headings, nested and task lists, tables,
 * quotes, rules, strikethrough, footnotes — plus LaTeX maths through KaTeX
 * (fractions, roots, matrices, aligned working) and highlighted code blocks
 * with a copy button. Pictures in the answer show inline and open full size.
 *
 * Safe by construction: raw HTML is never rendered (a `<br>` in a table cell
 * is the one tag let through, as a line break), links must be http(s) or
 * mailto, and pictures must be https.
 */

import "katex/dist/katex.min.css";

import type { Element, ElementContent, Root, RootContent } from "hast";
import { Check, Copy } from "lucide-react";
import { memo, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { ImageWithLightbox } from "@/components/os/image-lightbox";
import { prepareMarkdown } from "@/lib/markdown/prepare";
import { cn } from "@/lib/utils";

// ---- hast helpers ----------------------------------------------------------

function textOf(node: Root | RootContent | ElementContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map((child) => textOf(child)).join("");
  return "";
}

/** `<br>` written as HTML (models put them in table cells) becomes a real line break. */
function rehypeLineBreaks() {
  const walk = (parent: Root | Element) => {
    parent.children = parent.children.map((child) => {
      if (child.type === "raw" && /^<br\s*\/?>$/i.test(child.value.trim())) {
        return { type: "element", tagName: "br", properties: {}, children: [] } as Element;
      }
      if (child.type === "element") walk(child);
      return child;
    }) as typeof parent.children;
  };
  return (tree: Root) => walk(tree);
}

const REMARK = [remarkGfm, remarkBreaks, [remarkMath, { singleDollarTextMath: false }]] as never;
const REHYPE = [
  rehypeLineBreaks,
  [rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "inherit" }],
  [rehypeHighlight, { detect: false, plainText: ["txt", "text", "plaintext"] }],
] as never;

function safeUrl(url: string, key: string): string {
  if (key === "src") return /^https:\/\//i.test(url) ? url : "";
  if (/^(https?:|mailto:)/i.test(url) || url.startsWith("#")) return defaultUrlTransform(url);
  return "";
}

// ---- pieces --------------------------------------------------------------

export function CopyButton({
  text,
  label = "Copy",
  className,
  showLabel = true,
}: {
  text: string;
  label?: string;
  className?: string;
  showLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => undefined);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[7px] text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {showLabel ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}

function CodeBlock({ node, children }: { node?: Element | undefined; children?: ReactNode }) {
  const code = node?.children.find(
    (c): c is Element => c.type === "element" && c.tagName === "code",
  );
  const classes = (code?.properties?.["className"] as string[] | undefined) ?? [];
  const lang = classes.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
  const raw = textOf(code).replace(/\n$/, "");
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || "code"}</span>
        <CopyButton text={raw} label="Copy code" className="text-[12px]" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function MarkdownImage({ src, alt }: { src?: string | undefined; alt?: string | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  const caption = alt?.trim();
  return (
    <span className="md-figure">
      <ImageWithLightbox
        inline
        src={src}
        name={caption || "Image"}
        onError={() => setFailed(true)}
        className="md-img"
      />
      {caption ? <span className="md-caption">{caption}</span> : null}
    </span>
  );
}

/** A link whose text is just a site name — how web-search answers cite their sources. */
const SOURCE = /^(www\.)?([\w-]+\.)+[a-z]{2,}$/i;

const COMPONENTS: Components = {
  pre: ({ node, children }) => <CodeBlock node={node}>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  a: ({ node, href, children }) => {
    const text = textOf(node).trim();
    const source = SOURCE.test(text);
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={source ? "md-source" : undefined}
        title={source ? href : undefined}
      >
        {source ? text.replace(/^www\./i, "") : children}
      </a>
    );
  },
  img: ({ src, alt }) => (
    <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />
  ),
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="md-check" />
    ) : null,
};

/**
 * The answer, rendered.
 *
 * `useDeferredValue` lets a long, maths-heavy answer fall a frame behind the
 * stream instead of making typing and scrolling stutter while it arrives.
 */
export const Markdown = memo(function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const deferred = useDeferredValue(text);
  const source = useMemo(() => prepareMarkdown(deferred), [deferred]);
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        components={COMPONENTS}
        urlTransform={safeUrl}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

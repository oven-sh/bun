import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const SPEC_DIR = import.meta.dir;

interface SpecExample {
  markdown: string;
  expected: string;
  line: number;
  section: string;
  flags: string[];
}

function parseSpecFile(path: string): SpecExample[] {
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  const examples: SpecExample[] = [];
  const fence = "`".repeat(32);
  let i = 0;
  let currentSection = "";

  while (i < lines.length) {
    const line = lines[i];
    // Track section headers
    if (line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ")) {
      currentSection = line.replace(/^#+\s*/, "");
    }
    if (line.startsWith(fence + " example")) {
      const startLine = i + 1;
      i++;
      // Collect markdown input (until lone "." line)
      const mdLines: string[] = [];
      while (i < lines.length && lines[i] !== ".") {
        mdLines.push(lines[i]);
        i++;
      }
      i++; // skip the "."
      // Collect expected HTML (until closing fence)
      const htmlLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith(fence)) {
        htmlLines.push(lines[i]);
        i++;
      }
      // Extension spec files have a second "." followed by flags (e.g. "--ftables").
      // Strip trailing ".\n--fXXX\n--fYYY\n..." from expected HTML and save flags.
      let expectedHtml = htmlLines.join("\n");
      let flags: string[] = [];
      const flagMatch = expectedHtml.match(/\n\.\n((?:--[^\n]+\n?)+)$/);
      if (flagMatch) {
        expectedHtml = expectedHtml.slice(0, -flagMatch[0].length);
        flags = flagMatch[1]
          .trim()
          .split("\n")
          .flatMap((line: string) => line.split(/\s+/))
          .filter((f: string) => f.startsWith("--f"));
      }
      examples.push({
        markdown: mdLines.join("\n").replaceAll("\u2192", "\t"),
        expected: expectedHtml.replaceAll("\u2192", "\t"),
        line: startLine,
        section: currentSection,
        flags,
      });
    }
    i++;
  }
  return examples;
}

const Markdown = (Bun as any).Markdown;

function renderMarkdown(markdown: string, flags?: string[]): string {
  const options: Record<string, boolean> = {};
  if (flags && flags.length > 0) {
    for (const flag of flags) {
      // Strip --f prefix, replace - with _
      const name = flag.slice(3).replace(/-/g, "_");
      options[name] = true;
    }
  }
  return Markdown.renderToHTML(markdown + "\n", options);
}

// Normalize HTML for comparison, ported from md4c's normalize.py.
// This ignores insignificant output differences:
// - Whitespace around block-level tags is removed
// - Multiple whitespace chars collapsed to single space (outside <pre>)
// - Self-closing tags converted to open tags (<br /> → <br>)
function normalizeHtml(html: string): string {
  const blockTags = new Set([
    "article",
    "header",
    "aside",
    "hgroup",
    "blockquote",
    "hr",
    "iframe",
    "body",
    "li",
    "map",
    "button",
    "object",
    "canvas",
    "ol",
    "caption",
    "output",
    "col",
    "p",
    "colgroup",
    "pre",
    "dd",
    "progress",
    "div",
    "section",
    "dl",
    "table",
    "td",
    "dt",
    "tbody",
    "embed",
    "textarea",
    "fieldset",
    "tfoot",
    "figcaption",
    "th",
    "figure",
    "thead",
    "footer",
    "tr",
    "form",
    "ul",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "video",
    "script",
    "style",
  ]);

  let output = "";
  let lastType = "starttag";
  let lastTag = "";
  let inPre = false;

  // Simple HTML tokenizer: splits into tags and text
  const tokens = html.match(/<!\[CDATA\[.*?\]\]>|<!--.*?-->|<!\S[^>]*>|<\?[^>]*>|<\/?[a-zA-Z][^>]*\/?>|[^<]+/gs) || [];

  for (const token of tokens) {
    if (token.startsWith("<![CDATA")) {
      output += token;
      lastType = "data";
    } else if (token.startsWith("<!--")) {
      output += token;
      lastType = "comment";
    } else if (token.startsWith("<!") || token.startsWith("<?")) {
      output += token;
      lastType = "decl";
    } else if (token.startsWith("</")) {
      // End tag
      const tag = token.slice(2, -1).trim().toLowerCase();
      if (tag === "pre") inPre = false;
      if (blockTags.has(tag)) output = output.trimEnd();
      output += `</${tag}>`;
      lastTag = tag;
      lastType = "endtag";
    } else if (token.startsWith("<")) {
      // Start tag (possibly self-closing)
      const selfClosing = token.endsWith("/>");
      const inner = token.slice(1, selfClosing ? -2 : -1).trim();
      const spaceIdx = inner.search(/[\s\/]/);
      const tag = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).toLowerCase();

      if (tag === "pre") inPre = true;
      if (blockTags.has(tag)) output = output.trimEnd();

      // Parse attributes
      let attrStr = spaceIdx === -1 ? "" : inner.slice(spaceIdx).replace(/\/$/, "").trim();
      let attrs: [string, string | null][] = [];
      const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
      let m;
      while ((m = attrRe.exec(attrStr)) !== null) {
        const name = m[1].toLowerCase();
        const value = m[2] ?? m[3] ?? m[4] ?? null;
        attrs.push([name, value]);
      }
      attrs.sort((a, b) => a[0].localeCompare(b[0]));

      output += `<${tag}`;
      for (const [k, v] of attrs) {
        output += ` ${k}`;
        if (v !== null) output += `="${v}"`;
      }
      output += ">";

      lastTag = tag;
      // Self-closing tags are treated as endtags for whitespace purposes
      lastType = selfClosing ? "endtag" : "starttag";
    } else {
      // Text data
      let data = token;
      const afterTag = lastType === "endtag" || lastType === "starttag";
      const afterBlockTag = afterTag && blockTags.has(lastTag);

      if (afterTag && lastTag === "br") data = data.replace(/^\n/, "");
      if (!inPre) data = data.replace(/\s+/g, " ");
      if (afterBlockTag && !inPre) {
        if (lastType === "starttag") data = data.trimStart();
        else if (lastType === "endtag") data = data.trim();
      }

      output += data;
      lastType = "data";
    }
  }

  return output.trim();
}

const specFiles = [
  { name: "CommonMark", file: "spec.txt" },
  { name: "GFM Tables", file: "spec-tables.txt" },
  { name: "GFM Strikethrough", file: "spec-strikethrough.txt" },
  { name: "GFM Tasklists", file: "spec-tasklists.txt" },
  { name: "Permissive Autolinks", file: "spec-permissive-autolinks.txt" },
  { name: "GFM", file: "spec-gfm.txt" },
  { name: "Coverage", file: "coverage.txt" },
  { name: "Regressions", file: "regressions.txt" },
];

for (const { name, file } of specFiles) {
  const specPath = join(SPEC_DIR, file);
  let examples: SpecExample[];
  try {
    examples = parseSpecFile(specPath);
  } catch {
    continue;
  }
  if (examples.length === 0) continue;

  describe(name, () => {
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      test(`example ${i + 1} (line ${ex.line}): ${ex.section}`, () => {
        const actual = renderMarkdown(ex.markdown, ex.flags.length > 0 ? ex.flags : undefined);
        expect(normalizeHtml(actual)).toBe(normalizeHtml(ex.expected));
      });
    }
  });
}

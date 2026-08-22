import { expect, test } from "bun:test";
import { syntaxHighlight } from "../../src/runtime/bake/client/JavaScriptSyntaxHighlighter";

// The dev server error overlay runs each source line of a code preview through
// syntaxHighlight() on its own. The result is the line's tokens wrapped in
// spans, with every token body HTML-escaped. Undoing that gives back the
// source text the overlay shows for the line.
function sourceText(html: string): string {
  return html
    .replace(/<\/?span[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

test("syntaxHighlight tokenizes a template literal with an interpolation", () => {
  expect(syntaxHighlight("let a = `x${1}y`;")).toMatchInlineSnapshot(
    `"<span class="syntax-pink">let</span> <span class="syntax-fg">a</span> <span class="syntax-pink">=</span> <span class="syntax-yellow">\`x</span><span class="syntax-pink">\${</span><span class="syntax-purple">1</span><span class="syntax-pink">}</span><span class="syntax-yellow">y\`</span><span class="syntax-pink">;</span>"`,
  );
});

test("syntaxHighlight tokenizes a nested template literal", () => {
  expect(syntaxHighlight("`a${`b${c}d`}e`")).toMatchInlineSnapshot(
    `"<span class="syntax-yellow">\`a</span><span class="syntax-pink">\${</span><span class="syntax-yellow">\`b</span><span class="syntax-pink">\${</span><span class="syntax-fg">c</span><span class="syntax-pink">}</span><span class="syntax-yellow">d\`</span><span class="syntax-pink">}</span><span class="syntax-yellow">e\`</span>"`,
  );
});

test.each([
  // interpolations
  "let a = `x${1}y`;",
  "`${a}`",
  "f(`a${b}c${d}e`)",
  "`${ {a: 1}.a }`",
  "`a${`b${c}d`}e`",
  '`a${ "}" }b`',
  // escapes
  "`a\\`b${c}\\${d}`",
  "`a\\\\`+b",
  // one line of a template literal that spans several lines
  "const q = `first line of a",
  "  second line`;",
  "`a${b",
  "`a${b}c",
  // no template literal
  'const s = "plain";',
  "`no interp`",
])("syntaxHighlight keeps the source text of %s", line => {
  expect(sourceText(syntaxHighlight(line))).toBe(line);
});

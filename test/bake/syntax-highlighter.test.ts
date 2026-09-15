import { syntaxHighlight } from "bake/JavaScriptSyntaxHighlighter";
import { expect, test } from "bun:test";

// The dev server error overlay runs each source line of a code preview through
// syntaxHighlight() on its own. The result is a run of <span class="...">
// elements, one per colored token, with bare text for whitespace. Every token
// body is HTML-escaped.
function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// [class, text] per token. Bare text has the class "".
function tokens(html: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of html.matchAll(/<span class="([^"]*)">([^<]*)<\/span>|([^<]+)/g)) {
    out.push(m[3] === undefined ? [m[1], unescapeHtml(m[2])] : ["", unescapeHtml(m[3])]);
  }
  return out;
}

function sourceText(html: string): string {
  return tokens(html)
    .map(([, text]) => text)
    .join("");
}

test.each<[string, [string, string][]]>([
  [
    "let a = `x${1}y`;",
    [
      ["syntax-pink", "let"],
      ["", " "],
      ["syntax-fg", "a"],
      ["", " "],
      ["syntax-pink", "="],
      ["", " "],
      ["syntax-yellow", "`x"],
      ["syntax-pink", "${"],
      ["syntax-purple", "1"],
      ["syntax-pink", "}"],
      ["syntax-yellow", "y`"],
      ["syntax-pink", ";"],
    ],
  ],
  [
    // a nested template literal
    "`a${`b${c}d`}e`",
    [
      ["syntax-yellow", "`a"],
      ["syntax-pink", "${"],
      ["syntax-yellow", "`b"],
      ["syntax-pink", "${"],
      ["syntax-fg", "c"],
      ["syntax-pink", "}"],
      ["syntax-yellow", "d`"],
      ["syntax-pink", "}"],
      ["syntax-yellow", "e`"],
    ],
  ],
  [
    // braces inside the interpolation do not close it
    "`${ {a: 1}.a }`",
    [
      ["syntax-yellow", "`"],
      ["syntax-pink", "${"],
      ["", " "],
      ["syntax-pink", "{"],
      ["syntax-fg", "a"],
      ["syntax-pink", ":"],
      ["", " "],
      ["syntax-purple", "1"],
      ["syntax-pink", "}"],
      ["syntax-pink", "."],
      ["syntax-fg", "a"],
      ["", " "],
      ["syntax-pink", "}"],
      ["syntax-yellow", "`"],
    ],
  ],
  [
    "`${f({x})}`",
    [
      ["syntax-yellow", "`"],
      ["syntax-pink", "${"],
      ["syntax-green", "f"],
      ["syntax-pink", "("],
      ["syntax-pink", "{"],
      ["syntax-fg", "x"],
      ["syntax-pink", "}"],
      ["syntax-pink", ")"],
      ["syntax-pink", "}"],
      ["syntax-yellow", "`"],
    ],
  ],
  [
    // a brace inside a string inside the interpolation is part of the string
    '`a${ "}" }b`',
    [
      ["syntax-yellow", "`a"],
      ["syntax-pink", "${"],
      ["", " "],
      ["syntax-yellow", '"}"'],
      ["", " "],
      ["syntax-pink", "}"],
      ["syntax-yellow", "b`"],
    ],
  ],
  [
    // \` and \${ are literal text
    "`a\\`b${c}\\${d}`",
    [
      ["syntax-yellow", "`a\\`b"],
      ["syntax-pink", "${"],
      ["syntax-fg", "c"],
      ["syntax-pink", "}"],
      ["syntax-yellow", "\\${d}`"],
    ],
  ],
  [
    // \\ is one escape, so the backtick after it closes the literal
    "`a\\\\`+b",
    [
      ["syntax-yellow", "`a\\\\`"],
      ["syntax-pink", "+"],
      ["syntax-fg", "b"],
    ],
  ],
  [
    // \\ is one escape, so the ${ after it starts an interpolation
    "`\\\\${a}`",
    [
      ["syntax-yellow", "`\\\\"],
      ["syntax-pink", "${"],
      ["syntax-fg", "a"],
      ["syntax-pink", "}"],
      ["syntax-yellow", "`"],
    ],
  ],
  [
    // the first line of a template literal that spans several lines
    "const q = `first line of a",
    [
      ["syntax-pink", "const"],
      ["", " "],
      ["syntax-fg", "q"],
      ["", " "],
      ["syntax-pink", "="],
      ["", " "],
      ["syntax-yellow", "`first line of a"],
    ],
  ],
  [
    // a line that ends inside an interpolation
    "`a${b",
    [
      ["syntax-yellow", "`a"],
      ["syntax-pink", "${"],
      ["syntax-fg", "b"],
    ],
  ],
])("syntaxHighlight tokenizes %s", (line, expected) => {
  expect(tokens(syntaxHighlight(line))).toEqual(expected);
});

test.each([
  "let a = `x${1}y`;",
  "`${a}`",
  "`${a}${b}`",
  "f(`a${b}c${d}e`)",
  "`${ {a: 1}.a }`",
  "`a${`b${c}d`}e`",
  '`a${ "}" }b`',
  "`a\\`b${c}\\${d}`",
  "`a\\\\`+b",
  "`\\\\${a}`",
  "const q = `first line of a",
  "  second line`;",
  "`a${b",
  "`a${b}c",
  'const s = "plain";',
  "`no interp`",
])("syntaxHighlight keeps the source text of %s", line => {
  expect(sourceText(syntaxHighlight(line))).toBe(line);
});

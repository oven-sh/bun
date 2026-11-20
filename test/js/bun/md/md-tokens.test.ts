import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
// What `marked.lexer()` of marked 15.0.12 returns.
import marked from "./marked-15-tokens.json";

const { tokens } = Bun.markdown;

test.each(marked)("as marked: $input", expected => {
  expect(tokens(expected.input, { autolinks: true })).toEqual(expected.tokens as any);
});

describe.each(["\n", "\r\n", "\r"])("the raw of the tokens is the document, lines ending in %j", newline => {
  test.each(["spec.txt", "spec-gfm.txt", "regressions.txt"])("%s", file => {
    const examples = readFileSync(join(import.meta.dir, file), "utf8")
      .replace(/\r\n?/g, "\n")
      .split(/^`{32} example.*\n/m)
      .slice(1)
      .map(it => it.slice(0, it.search(/^\.$/m)).replaceAll("→", "\t").replaceAll("\n", newline));
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.map(input => tokens(input).reduce((raw, token) => raw + token.raw, ""))).toEqual(examples);
  });
});

test("only the raw of a block at the top level has the line endings of the document", () => {
  expect(tokens("> a\r\n> b\r\n")).toMatchObject([
    { raw: "> a\r\n> b\r\n", text: "a\nb", tokens: [{ raw: "a\nb", text: "a\nb" }] },
  ]);
});

test("definitions", () => {
  expect(tokens('[A  b]: </x\\_y> "t"\n[c]: /z\nHead [a b]\n===\n- [d]: /w\n')).toMatchObject([
    { type: "def", tag: "a b", href: "/x_y", title: "t", raw: '[A  b]: </x\\_y> "t"\n' },
    { type: "def", tag: "c", href: "/z", title: undefined },
    { type: "heading", tokens: [{ type: "text" }, { type: "link", raw: "[a b]", href: "/x_y", title: "t" }] },
    { type: "list", items: [{ tokens: [{ type: "def", tag: "d" }] }] },
  ]);
});

test("heading ids, wiki links and extra cells", () => {
  expect(tokens("# a\n# a", { headings: true }).map(token => (token as any).id)).toEqual(["a", "a-1"]);
  expect(tokens("[[a|b]]", { wikiLinks: true })).toMatchObject([
    { tokens: [{ type: "wikilink", raw: "[[a|b]]", target: "a", text: "b" }] },
  ]);
  expect(tokens("|a|\n|-|\n|b|c|", { tableExtraCells: true })).toMatchObject([
    { align: [null], rows: [[{ text: "b" }, { text: "c" }]] },
  ]);
});

test("noIndentedCodeBlocks", () => {
  expect(tokens("> a\n     >\n     > b\n\n-      x\n\n       y", { noIndentedCodeBlocks: true })).toMatchObject([
    { text: "a\n\nb", tokens: [{ raw: "a" }, { raw: "\n\n" }, { raw: "b" }] },
    { type: "space" },
    { items: [{ text: "x\n\ny" }] },
  ]);
});

test("a marker takes one column of a tab", () => {
  expect(tokens(">\ta\n>\tb\n\n-\t\tc")).toMatchObject([
    { raw: ">\ta\n>\tb", text: "  a\n  b", tokens: [{ raw: "  a\n  b" }] },
    { type: "space" },
    { raw: "-\t\tc", items: [{ text: "  \tc", tokens: [{ type: "code" }] }] },
  ]);
});

test("a URL that emphasis ends keeps its closed parentheses", () => {
  expect(tokens("*http://a.test/a(b)c*d(", { autolinks: true })).toMatchObject([
    { tokens: [{ type: "em", tokens: [{ type: "link", href: "http://a.test/a(b)c" }] }, { text: "d(" }] },
  ]);
});

test.each([
  [1, "text"],
  [2, "link"],
])("an autolink in an image with maxNesting: %d is %s", (maxNesting, type) => {
  expect(tokens("![<https://a.b>](c)", { maxNesting })).toMatchObject([{ tokens: [{ tokens: [{ type }] }] }]);
});

test("a byte order mark is in the raw of the first token", () => {
  expect(tokens("﻿# a")).toMatchObject([{ type: "heading", raw: "﻿# a", text: "a" }]);
});

test("bytes that are not UTF-8", () => {
  expect(tokens(Buffer.from([0xff, 0x20, 0x2a, 0x61, 0x2a]))).toMatchObject([
    { raw: "� *a*", tokens: [{ text: "� " }, { type: "em", raw: "*a*", text: "a" }] },
  ]);
});

test.each([
  ["> ", ""],
  ["- ", ""],
  ["*a ", " a*"],
  ["![", "](b)"],
])("%j nests 100 deep unless maxNesting says otherwise", (open, close) => {
  const input = Buffer.alloc(300 * open.length, open) + "x" + Buffer.alloc(300 * close.length, close || " ");
  const depth = (options?: Bun.markdown.Options) => {
    let count = 0;
    for (let level: any[] = tokens(input, options); ;) {
      const inner = level.find(token => token.items || token.tokens);
      if (!inner) return count;
      if (["blockquote", "list", "em", "image"].includes(inner.type)) count++;
      level = inner.items ?? inner.tokens;
    }
  };
  expect([depth(), depth({ maxNesting: 3 }), depth({ maxNesting: 1000 })]).toEqual([100, 3, 300]);
});

test.each([[undefined], [null], [1]])("tokens(%p) throws", input => {
  expect(() => tokens(input as any)).toThrow("Expected a string or buffer to render");
});

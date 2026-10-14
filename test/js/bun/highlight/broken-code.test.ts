import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { annotate, expectIntact, fixtures, fixturesDir, languageOf, stripTags } from "./util";

describe("broken code", () => {
  // Code that is still being typed, or still arriving, stops anywhere.
  test.each(fixtures)("%s, cut off", async file => {
    const code = await Bun.file(join(fixturesDir, file)).text();
    const language = languageOf(file);
    const step = Math.max(1, Math.floor(code.length / 150));
    for (let end = 0; end < code.length; end += step) {
      const cut = code.slice(0, end).toWellFormed();
      expect(stripTags(Bun.highlight.html(cut, language)!)).toBe(cut);
    }
  });

  test.each(fixtures)("%s, with a piece missing", async file => {
    const code = await Bun.file(join(fixturesDir, file)).text();
    const language = languageOf(file);
    const step = Math.max(1, Math.floor(code.length / 60));
    for (let at = 0; at + 7 < code.length; at += step) {
      const damaged = (code.slice(0, at) + code.slice(at + 7)).toWellFormed();
      expect(stripTags(Bun.highlight.html(damaged, language)!)).toBe(damaged);
    }
  });

  const languages = [...new Set(fixtures.map(languageOf))];
  const inputs = [
    "\0",
    "\0\0\0 a \0",
    "\\",
    '"',
    "'",
    "`",
    "`${",
    "/*",
    "<!--",
    "<",
    "</",
    "<a",
    "<a b=",
    '<a b="',
    "{{",
    "{{#",
    "{#",
    "${",
    "#{",
    "@",
    "---",
    "---\n",
    "```",
    "```js\nlet a = `",
    "[",
    "[a](",
    "&",
    "&amp",
    "\r",
    "\r\n\r\n",
    "a\rb\r\nc",
    "\u2028\u2029",
    "\uFEFF",
    "\uFEFF\uFEFF",
    "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> c",
    "...",
    "a: b: c: d",
    "}}}}]]]]))))",
    "😀",
  ];
  test.each(languages)("%s: odd inputs", language => {
    for (const input of inputs) expectIntact(input, language);
  });

  test.each(languages)("%s: bytes that aren't UTF-8", language => {
    for (const bytes of [[0xff], [0xc3], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0x61, 0x80, 0x62], [0xed, 0xa0, 0x80]]) {
      expect(Bun.highlight.html(new Uint8Array(bytes), language)).toBeString();
      expect(Bun.highlight.html(new Uint8Array([0x22, ...bytes, 0x22, 0x0a, ...bytes]), language)).toBeString();
    }
  });

  test.each(languages)("%s: deep nesting", language => {
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
      ["<a>", "</a>"],
      ["<", ">"],
      ["`${", "}`"],
      ["> ", ""],
      ["- ", ""],
      ["{{#a}}", "{{/a}}"],
      ["{#if a}", "{/if}"],
      ["a{", "}"],
      ["a:\n", ""],
    ]) {
      const depth = 2_000;
      const opens = Buffer.alloc(open.length * depth, open).toString();
      const closed = opens + Buffer.alloc(close.length * depth, close).toString();
      expect(stripTags(Bun.highlight.html(opens, language)!)).toBe(opens);
      expect(stripTags(Bun.highlight.html(closed, language)!)).toBe(closed);
    }
  });

  test("what comes before an error looks the same as without it", () => {
    const good = "function f(a: number) { return a; }\nconst b = f(1);\n";
    const before = annotate(good, "ts");
    for (const bad of ['const c = "', "const c = `${", "if (", "class {", "@", "/*", "<"]) {
      expect(annotate(good + bad, "ts")).toStartWith(before);
    }
  });

  test("what comes after an error is still highlighted", () => {
    const after = "\nfunction f(a: number) { return a; }";
    for (const bad of ['const c = "', "const c = ;", "foo(1, 2", "const = 1;", "...", "}}}"]) {
      expect(annotate(bad + after, "ts")).toEndWith(
        "⟦keyword|function⟧ ⟦function|f⟧⟦punctuation.bracket|(⟧⟦variable.parameter|a⟧⟦punctuation.delimiter|:⟧ ⟦type.builtin|number⟧⟦punctuation.bracket|)⟧ " +
          "⟦punctuation.bracket|{⟧ ⟦keyword.control|return⟧ ⟦variable.parameter|a⟧⟦punctuation.delimiter|;⟧ ⟦punctuation.bracket|}⟧",
      );
    }
  });
});

// Each of these took quadratic time at some point. At this size that is seconds in a release build and far beyond the
// timeout in a debug build, and linear time is milliseconds.
describe("something unclosed, over and over", () => {
  test.each([
    ["js", "`${"],
    ["js", "html`<script>"],
    ["js", "css`a{${"],
    ["html", "<script>html`"],
    ["html", "<style>a{"],
    ["vue", "<template><a :b='"],
    ["svelte", "{#if /[}"],
    ["svelte", "{'\\'"],
    ["svelte", "{a <b "],
    ["mdx", "a {/[} b "],
    ["mdx", "{'\\'"],
    ["mdx", "<A b={"],
    ["md", "```md\n"],
    ["md", "> ```js\n> `"],
    ["md", "[a]("],
    ["hbs", "{{#a "],
    ["angular", "@if (a) { {{ "],
    ["scss", "a{#{"],
    ["less", "@{a"],
    ["yaml", "a: [\n"],
    ["yaml", 'a: "\n'],
    ["toml", 'a = "\n'],
    ["toml", "[a\n"],
    ["graphql", "{ a(b: "],
  ])("%s: %j", (language, piece) => {
    const code = Buffer.alloc(128 * 1024, piece).toString();
    expect(stripTags(Bun.highlight.html(code, language)!)).toBe(code);
  });

  test.each(["md", "mdx"])("%s: fences in fences, each a backtick shorter", language => {
    let [open, close] = ["", ""];
    for (let length = 1_000; length >= 3; length--) {
      const fence = Buffer.alloc(length, "`").toString();
      open += `${fence}${language}\n`;
      close = `${fence}\n${close}`;
    }
    const code = `${open}# a\n${close}`;
    expect(stripTags(Bun.highlight.html(code, language)!)).toBe(code);
  });
});

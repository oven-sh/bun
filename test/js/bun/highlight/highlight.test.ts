import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { bunEnv, bunExe } from "harness";
import { basename, join } from "node:path";

const fixturesDir = join(import.meta.dir, "fixtures");
const fixtures = [...new Glob("*").scanSync(fixturesDir)].sort();

function languageOf(file: string): string {
  return file.endsWith(".component.html") ? "angular" : file.slice(file.lastIndexOf(".") + 1);
}

const unescape = (html: string) => html.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const stripTags = (html: string) => unescape(html.replace(/<\/?span[^>]*>/g, ""));
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

/** `hl-keyword hl-keyword-control` is `keyword.control`. */
const nameOf = (classes: string) => classes.split(" ").at(-1)!.slice("hl-".length).replaceAll("-", ".");

/** `[["const", "keyword"], ["a", "variable"], ...]` */
function tokens(code: string, language: string): [string, string][] {
  const html = Bun.highlight.html(code, language);
  if (html === null) throw new Error(`${language} is not highlighted`);
  return [...html.matchAll(/<span class="([^"]+)">([^<]*)<\/span>/g)].map(([, classes, text]) => [
    unescape(text),
    nameOf(classes),
  ]);
}

/** What `text` is, each time it occurs. */
function tokensOf(code: string, language: string, text: string): string[] {
  return tokens(code, language)
    .filter(token => token[0] === text)
    .map(token => token[1]);
}

/** The code with each token as `⟦name|text⟧`. */
function annotate(code: string, language: string): string {
  return unescape(
    Bun.highlight
      .html(code, language)!
      .replace(/<span class="([^"]+)">([^<]*)<\/span>/g, (_, classes, text) => `⟦${nameOf(classes)}|${text}⟧`),
  );
}

const { Theme } = Bun.highlight;
const trueColor = new Theme("dark", { colorDepth: 24 });

/** Whatever the input is, the output is the input plus markup. */
function expectIntact(code: string, language: string) {
  const html = Bun.highlight.html(code, language)!;
  expect(stripTags(html)).toBe(code);
  for (const line of html.split("\n")) {
    expect(line.split("<span ").length).toBe(line.split("</span>").length);
  }
  const ansi = trueColor.ansi(code, language)!;
  expect(stripAnsi(ansi)).toBe(code);
}

describe("html", () => {
  test("wraps each token in a span", () => {
    expect(Bun.highlight.html("if (a) return 1;", "js")).toBe(
      '<span class="hl-keyword hl-keyword-control">if</span> ' +
        '<span class="hl-punctuation hl-punctuation-bracket">(</span>' +
        '<span class="hl-variable">a</span>' +
        '<span class="hl-punctuation hl-punctuation-bracket">)</span> ' +
        '<span class="hl-keyword hl-keyword-control">return</span> ' +
        '<span class="hl-number">1</span>' +
        '<span class="hl-punctuation hl-punctuation-delimiter">;</span>',
    );
  });

  test("escapes &, < and > in tokens and between them", () => {
    expect(Bun.highlight.html(`a < b && "<&>"`, "js")).toBe(
      '<span class="hl-variable">a</span> ' +
        '<span class="hl-operator">&lt;</span> ' +
        '<span class="hl-variable">b</span> ' +
        '<span class="hl-operator">&amp;&amp;</span> ' +
        '<span class="hl-string">"&lt;&amp;&gt;"</span>',
    );
    expect(Bun.highlight.html("<a>x & y</a>", "jsx")).toContain("x &amp; y");
  });

  test("no span crosses a line break", () => {
    expect(Bun.highlight.html("/* a\n\n b */", "js")).toBe(
      '<span class="hl-comment">/* a</span>\n\n<span class="hl-comment"> b */</span>',
    );
    expect(Bun.highlight.html("`a\n`", "js")).toBe(
      '<span class="hl-string">`a</span>\n<span class="hl-string">`</span>',
    );
  });

  test("an empty string stays empty", () => {
    for (const file of fixtures) expect(Bun.highlight.html("", languageOf(file))).toBe("");
  });

  test("takes bytes", () => {
    const expected = Bun.highlight.html("let é = 1", "js");
    const bytes = new TextEncoder().encode("let é = 1");
    expect(Bun.highlight.html(bytes, "js")).toBe(expected);
    expect(Bun.highlight.html(bytes.buffer, "js")).toBe(expected);
    expect(Bun.highlight.html(Buffer.from(bytes), "js")).toBe(expected);
    expect(Bun.highlight.html(new DataView(bytes.buffer), "js")).toBe(expected);
  });

  test("keeps a byte order mark", () => {
    expect(Bun.highlight.html("\uFEFFlet a", "js")).toBe(
      '\uFEFF<span class="hl-keyword">let</span> <span class="hl-variable">a</span>',
    );
  });

  test.each([
    ["Latin-1", "const é = 'ü'; // ñ"],
    ["UTF-16", "const 日本語 = '😀'; // ✓"],
    ["lone surrogates", "const a = '\ud800'; // \udc00"],
  ])("%s strings", (_, code) => {
    const html = Bun.highlight.html(code, "js")!;
    expect(stripTags(html)).toBe(code.toWellFormed());
  });
});

describe("languages", () => {
  test("returns null for a language it doesn't know", () => {
    expect(Bun.highlight.html("x", "python")).toBeNull();
    expect(trueColor.ansi("x", "python")).toBeNull();
    expect(Bun.highlight.html("x", "")).toBeNull();
    expect(Bun.highlight.html("x", "a-name-that-is-longer-than-any-language")).toBeNull();
  });

  test("names are case-insensitive", () => {
    expect(Bun.highlight.html("let a", "JS")).toBe(Bun.highlight.html("let a", "js"));
    expect(Bun.highlight.html("let a", "TypeScript")).toBe(Bun.highlight.html("let a", "ts"));
  });

  test.each([
    ["javascript", "js", "mjs", "cjs"],
    ["typescript", "ts", "mts", "cts"],
    ["json", "jsonc", "json5"],
    ["html", "htm"],
    ["handlebars", "hbs"],
    ["markdown", "md"],
    ["yaml", "yml"],
    ["graphql", "gql"],
  ])("%s has other names", (name, ...others) => {
    const code = `{ "a": [1, true] }`;
    for (const other of others) expect(Bun.highlight.html(code, other)).toBe(Bun.highlight.html(code, name));
  });

  test("throws if the language isn't a string", () => {
    // @ts-expect-error
    expect(() => Bun.highlight.html("x")).toThrow('The "language" argument must be of type string. Received undefined');
    // @ts-expect-error
    expect(() => Bun.highlight.html("x", 1)).toThrow('The "language" argument must be of type string');
    // @ts-expect-error
    expect(() => trueColor.ansi("x", {})).toThrow('The "language" argument must be of type string');
  });

  test("throws if the code isn't a string or bytes", () => {
    // @ts-expect-error
    expect(() => Bun.highlight.html(1, "js")).toThrow(
      'The "code" argument must be of type string, TypedArray or ArrayBuffer',
    );
    // @ts-expect-error
    expect(() => trueColor.ansi(undefined, "js")).toThrow('The "code" argument must be of type string');
  });
});

describe("JavaScript and TypeScript", () => {
  test("a parameter is one wherever it is used", () => {
    expect(tokensOf("function f(a, { b }, [c] = []) { return a + b + c; }", "js", "a")).toEqual([
      "variable.parameter",
      "variable.parameter",
    ]);
    expect(tokensOf("const f = (a, { b }) => () => b;", "js", "b")).toEqual([
      "variable.parameter",
      "variable.parameter",
    ]);
  });

  test("a name is what it is declared as", () => {
    const code = `
      function fn() {}
      class Class {}
      const arrow = () => {};
      const Expression = class {};
      let plain = 1;
      use(fn, Class, arrow, Expression, plain);
    `;
    expect(tokensOf(code, "js", "fn")).toEqual(["function", "function"]);
    expect(tokensOf(code, "js", "Class")).toEqual(["type", "type"]);
    expect(tokensOf(code, "js", "arrow")).toEqual(["function", "function"]);
    expect(tokensOf(code, "js", "Expression")).toEqual(["type", "type"]);
    expect(tokensOf(code, "js", "plain")).toEqual(["variable", "variable"]);
  });

  test("an import is what it is used as", () => {
    const code = `
      import def, { called, Constructed, Extended, tagged, Component, other, type OnlyType } from "a";
      import * as ns from "b";
      import type Default from "c";
      called(); new Constructed(); class A extends Extended {} tagged\`\`; <Component />;
      let x: def = other;
    `;
    const first = (name: string) => tokensOf(code, "tsx", name)[0];
    expect(first("called")).toBe("function");
    expect(first("Constructed")).toBe("type");
    expect(first("Extended")).toBe("type");
    expect(first("tagged")).toBe("function");
    expect(first("Component")).toBe("type");
    expect(first("other")).toBe("variable");
    expect(first("OnlyType")).toBe("type");
    expect(first("def")).toBe("type");
    expect(first("ns")).toBe("namespace");
    expect(first("Default")).toBe("type");
  });

  test("a variable that is called is a function where it is declared", () => {
    expect(tokensOf("const [value, setValue] = useState(); setValue(value);", "js", "setValue")).toEqual([
      "function",
      "function",
    ]);
  });

  test("a word that is only sometimes a keyword", () => {
    const names = "let type = 1, of = 2, async = 3, get = 4, as = 5, from = 6; use(type, of, async, get, as, from);";
    for (const name of ["type", "of", "async", "get", "as", "from"]) {
      expect(tokensOf(names, "ts", name)).toEqual(["variable", "variable"]);
    }
    expect(tokensOf("type A = 1;", "ts", "type")).toEqual(["keyword"]);
    expect(tokensOf("for (const a of b);", "ts", "of")).toEqual(["keyword.operator"]);
    expect(tokensOf("async function f() {}", "ts", "async")).toEqual(["keyword.modifier"]);
    expect(tokensOf("({ get a() {} })", "ts", "get")).toEqual(["keyword.modifier"]);
    expect(tokensOf("a as b", "ts", "as")).toEqual(["keyword.operator"]);
    expect(tokensOf(`import { a as b } from "c";`, "ts", "as")).toEqual(["keyword.import"]);
    expect(tokensOf(`import a from "c";`, "ts", "from")).toEqual(["keyword.import"]);
  });

  test("a reserved word that is a name", () => {
    expect(tokensOf("a.if; ({ if: 1 }); class A { if() {} }", "js", "if")).toEqual([
      "property",
      "property",
      "function.method",
    ]);
  });

  test("a slash divides or starts a regular expression", () => {
    expect(tokens("a / b / c", "js").map(token => token[1])).toEqual([
      "variable",
      "operator",
      "variable",
      "operator",
      "variable",
    ]);
    expect(tokens("a = /b/g.test(c) / 2", "js")).toContainEqual(["/b/g", "string.regexp"]);
    expect(tokens("if (a) /b/.test(c)", "js")).toContainEqual(["/b/", "string.regexp"]);
    expect(tokens("x = a++ / 2", "js")).toContainEqual(["/", "operator"]);
  });

  test("an angle bracket compares, opens type arguments, or opens a tag", () => {
    expect(tokensOf("a < b", "tsx", "<")).toEqual(["operator"]);
    expect(tokensOf("f<T>(a)", "tsx", "<")).toEqual(["punctuation.bracket"]);
    expect(tokensOf("<T,>(a: T) => a", "tsx", "<")).toEqual(["punctuation.bracket"]);
    expect(tokensOf("<a />", "tsx", "<")).toEqual(["tag.delimiter"]);
    expect(tokensOf("<T>a", "ts", "<")).toEqual(["punctuation.bracket"]);
    expect(tokens("new Map<string, Array<Set<number>>>()", "ts")).toContainEqual([">>>()", "punctuation.bracket"]);
    expect(tokensOf("a >>> b", "ts", ">>>")).toEqual(["operator"]);
  });

  test("templates nest", () => {
    expect(tokens("`a${`b${c}`}d`", "js")).toEqual([
      ["`a", "string"],
      ["${", "punctuation.special"],
      ["`b", "string"],
      ["${", "punctuation.special"],
      ["c", "variable"],
      ["}", "punctuation.special"],
      ["`", "string"],
      ["}", "punctuation.special"],
      ["d`", "string"],
    ]);
  });

  test("escape sequences", () => {
    expect(tokens(String.raw`"a\n\x41\u0041\u{1F600}\0\'"`, "js")).toEqual([
      ['"a', "string"],
      [String.raw`\n\x41\u0041\u{1F600}\0\'`, "string.escape"],
      ['"', "string"],
    ]);
  });

  test("types", () => {
    const code = "function f<T extends object>(a: T, b: string, c: Map<string, A.B.C>): Promise<T> {}";
    expect(tokensOf(code, "ts", "T")).toEqual(["type.parameter", "type.parameter", "type.parameter"]);
    expect(tokensOf(code, "ts", "string")).toEqual(["type.builtin", "type.builtin"]);
    expect(tokensOf(code, "ts", "object")).toEqual(["type.builtin"]);
    expect(tokensOf(code, "ts", "Map")).toEqual(["type"]);
    expect(tokensOf(code, "ts", "Promise")).toEqual(["type"]);
    expect(tokensOf(code, "ts", "A")).toEqual(["namespace"]);
    expect(tokensOf(code, "ts", "B")).toEqual(["namespace"]);
    expect(tokensOf(code, "ts", "C")).toEqual(["type"]);
  });

  test("enums", () => {
    const code = "enum Color { Red, Green = Red } Color.Green; other.Green;";
    expect(tokensOf(code, "ts", "Color")).toEqual(["type", "type"]);
    expect(tokensOf(code, "ts", "Red")).toEqual(["constant", "constant"]);
    expect(tokensOf(code, "ts", "Green")).toEqual(["constant", "constant", "property"]);
  });

  test("classes", () => {
    const code = `
      @decorator @other.args(1)
      class A extends B.C {
        static #private = 1;
        constructor(public a: number) { super(); this.#private; }
        get accessor() { return 1; }
        method() {}
        field = () => {};
        plain = 1;
      }
    `;
    expect(tokens(code, "ts")).toContainEqual(["@decorator", "decorator"]);
    expect(tokensOf(code, "ts", "args")).toEqual(["decorator"]);
    expect(tokensOf(code, "ts", "C")).toEqual(["type"]);
    expect(tokensOf(code, "ts", "#private")).toEqual(["property", "property"]);
    expect(tokensOf(code, "ts", "constructor")).toEqual(["keyword"]);
    expect(tokensOf(code, "ts", "public")).toEqual(["keyword.modifier"]);
    expect(tokensOf(code, "ts", "super")).toEqual(["variable.builtin"]);
    expect(tokensOf(code, "ts", "this")).toEqual(["variable.builtin"]);
    expect(tokensOf(code, "ts", "accessor")).toEqual(["function.method"]);
    expect(tokensOf(code, "ts", "method")).toEqual(["function.method"]);
    expect(tokensOf(code, "ts", "field")).toEqual(["function.method"]);
    expect(tokensOf(code, "ts", "plain")).toEqual(["property"]);
  });

  test("labels", () => {
    expect(tokensOf("a: for (;;) { break a; continue a; }", "js", "a")).toEqual(["label", "label", "label"]);
  });

  test("names in capitals, and names that nothing declares", () => {
    const code = "const MAX_SIZE = 1; use(MAX_SIZE, undefined, NaN, Infinity, arguments, Promise, JSON, console);";
    expect(tokensOf(code, "js", "MAX_SIZE")).toEqual(["constant", "constant"]);
    expect(tokensOf(code, "js", "undefined")).toEqual(["constant.builtin"]);
    expect(tokensOf(code, "js", "NaN")).toEqual(["constant.builtin"]);
    expect(tokensOf(code, "js", "Infinity")).toEqual(["constant.builtin"]);
    expect(tokensOf(code, "js", "arguments")).toEqual(["variable.builtin"]);
    expect(tokensOf(code, "js", "Promise")).toEqual(["type"]);
    expect(tokensOf(code, "js", "JSON")).toEqual(["type"]);
    expect(tokensOf(code, "js", "console")).toEqual(["variable"]);
  });

  test("JSX", () => {
    expect(annotate(`<a.b c="d &amp; e" f={g} {...h}>i &lt; {/* j */}<k-l /><></></a.b>`, "jsx")).toBe(
      "⟦tag.delimiter|<⟧⟦tag.component|a⟧⟦punctuation.delimiter|.⟧⟦tag.component|b⟧ " +
        '⟦attribute|c⟧⟦operator|=⟧⟦string|"d ⟧⟦string.escape|&amp;⟧⟦string| e"⟧ ' +
        "⟦attribute|f⟧⟦operator|=⟧⟦punctuation.special|{⟧⟦variable|g⟧⟦punctuation.special|}⟧ " +
        "⟦punctuation.special|{⟧⟦operator|...⟧⟦variable|h⟧⟦punctuation.special|}⟧⟦tag.delimiter|>⟧" +
        "i ⟦string.escape|&lt;⟧ ⟦punctuation.special|{⟧⟦comment|/* j */⟧⟦punctuation.special|}⟧" +
        "⟦tag.delimiter|<⟧⟦tag|k-l⟧ ⟦tag.delimiter|/><></></⟧" +
        "⟦tag.component|a⟧⟦punctuation.delimiter|.⟧⟦tag.component|b⟧⟦tag.delimiter|>⟧",
    );
  });

  test("JSDoc", () => {
    expect(annotate("/** @param {string} [name=1] text\n * @returns {T} text */", "js")).toBe(
      "⟦comment.doc|/** ⟧⟦keyword|@param⟧⟦comment.doc| ⟧⟦type|{string}⟧⟦comment.doc| [⟧⟦variable.parameter|name⟧⟦comment.doc|=1] text⟧\n" +
        "⟦comment.doc| * ⟧⟦keyword|@returns⟧⟦comment.doc| ⟧⟦type|{T}⟧⟦comment.doc| text */⟧",
    );
    expect(tokens("/**/ /***/ /* a */ // b", "js").map(token => token[1])).toEqual([
      "comment",
      "comment.doc",
      "comment",
      "comment",
    ]);
  });

  test("a shebang", () => {
    expect(tokens("#!/usr/bin/env bun\na", "js")[0]).toEqual(["#!/usr/bin/env bun", "keyword.directive"]);
  });
});

describe("JSON", () => {
  test("keys, values, and what JSON5 adds", () => {
    expect(annotate(`{ "a": "b", c: [-1, +.5, NaN, true, null], /* d */ 'e': 0x1, }`, "json")).toBe(
      '⟦punctuation.bracket|{⟧ ⟦property|"a"⟧⟦punctuation.delimiter|:⟧ ⟦string|"b"⟧⟦punctuation.delimiter|,⟧ ' +
        "⟦property|c⟧⟦punctuation.delimiter|:⟧ ⟦punctuation.bracket|[⟧⟦number|-1⟧⟦punctuation.delimiter|,⟧ ⟦number|+.5⟧⟦punctuation.delimiter|,⟧ " +
        "⟦constant.builtin|NaN⟧⟦punctuation.delimiter|,⟧ ⟦boolean|true⟧⟦punctuation.delimiter|,⟧ ⟦constant.builtin|null⟧⟦punctuation.bracket|]⟧⟦punctuation.delimiter|,⟧ " +
        "⟦comment|/* d */⟧ ⟦property|'e'⟧⟦punctuation.delimiter|:⟧ ⟦number|0x1⟧⟦punctuation.delimiter|,⟧ ⟦punctuation.bracket|}⟧",
    );
  });

  test("a key in quotes is a string in JavaScript", () => {
    expect(tokensOf(`({ "a": 1 })`, "js", '"a"')).toEqual(["string"]);
  });
});

describe("code in other code", () => {
  test("CSS in a template", () => {
    const code = "const A = styled.div`color: ${a}; &:hover { margin: 1px }`;";
    expect(tokens(code, "js")).toContainEqual(["color", "property"]);
    expect(tokens(code, "js")).toContainEqual(["a", "variable"]);
    expect(tokens(code, "js")).toContainEqual([":hover", "selector.pseudo"]);
    expect(tokens(code, "js")).toContainEqual(["px", "number.unit"]);
    expectIntact(code, "js");
  });

  test("a template in a template", () => {
    const code = "css`a { ${b && css`color: red;`} } ${`plain`}`";
    expect(tokens(code, "js")).toContainEqual(["color", "property"]);
    expect(tokens(code, "js")).toContainEqual(["`plain`", "string"]);
    expectIntact(code, "js");
  });

  test("GraphQL in a template", () => {
    const code = "gql`query A($b: Int) { c(d: $b) } ${fragment}`";
    expect(tokens(code, "js")).toContainEqual(["query", "keyword"]);
    expect(tokens(code, "js")).toContainEqual(["Int", "type.builtin"]);
    expect(tokens(code, "js")).toContainEqual(["fragment", "variable"]);
    expect(tokens("/* GraphQL */ `type A { b: Int }`", "js")).toContainEqual(["Int", "type.builtin"]);
  });

  test("HTML in a template", () => {
    const code = "html`<p class=${a}>b</p>`";
    expect(tokens(code, "js")).toContainEqual(["p", "tag"]);
    expect(tokens(code, "js")).toContainEqual(["class", "attribute"]);
    expectIntact(code, "js");
  });

  test("a template with another tag is a string", () => {
    expect(tokens("other`a { }`", "js")).toContainEqual(["`a { }`", "string"]);
  });

  test("script and style in HTML", () => {
    const code = `<script>let a = 1;</script><style>a { color: red }</style><script type="application/json">{"b": 1}</script>`;
    expect(tokens(code, "html")).toContainEqual(["let", "keyword"]);
    expect(tokens(code, "html")).toContainEqual(["color", "property"]);
    expect(tokens(code, "html")).toContainEqual(['"b"', "property"]);
  });

  test("code blocks and front matter in Markdown", () => {
    const code = "---\na: 1\n---\n\n```ts\nlet a: string;\n```\n\n```python\nlet a\n```\n";
    expect(tokens(code, "md")).toContainEqual(["a", "property"]);
    expect(tokens(code, "md")).toContainEqual(["let", "keyword"]);
    expect(tokens(code, "md")).toContainEqual(["string", "type.builtin"]);
    expect(tokens(code, "md")).toContainEqual(["let a", "markup.raw"]);
  });
});

describe("Theme", () => {
  const styles = { keyword: "#ff0000", number: { color: "rgb(0 255 0)", bold: true }, comment: { italic: true } };
  const theme = new Theme(styles, { colorDepth: 24 });

  describe("ansi", () => {
    test("24-bit colors", () => {
      expect(theme.ansi("let a = 1;", "js")).toBe(
        "\x1b[38;2;255;0;0mlet\x1b[39m a = \x1b[38;2;0;255;0;1m1\x1b[39;22m;",
      );
    });

    test("256 colors", () => {
      expect(new Theme(styles, { colorDepth: 8 }).ansi("let a = 1;", "js")).toBe(
        "\x1b[38;5;196mlet\x1b[39m a = \x1b[38;5;46;1m1\x1b[39;22m;",
      );
    });

    test("16 colors", () => {
      expect(new Theme(styles, { colorDepth: 4 }).ansi("let a = 1;", "js")).toBe(
        "\x1b[91mlet\x1b[39m a = \x1b[92;1m1\x1b[39;22m;",
      );
    });

    test("no colors", () => {
      expect(new Theme(styles, { colorDepth: 1 }).ansi("let a = 1;", "js")).toBe("let a = 1;");
    });

    test("the color stays on between two tokens that share it", () => {
      expect(theme.ansi("const enum", "ts")).toBe("\x1b[38;2;255;0;0mconst enum\x1b[39m");
    });

    test("every line resets what it sets", () => {
      expect(theme.ansi("/* a\n\n b */ if", "js")).toBe(
        "\x1b[3m/* a\x1b[23m\n\n\x1b[3m b */ \x1b[38;2;255;0;0;23mif\x1b[39m",
      );
    });

    test("built-in themes", () => {
      const dark = new Theme("dark", { colorDepth: 24 }).ansi("let a", "js");
      const light = new Theme("light", { colorDepth: 24 }).ansi("let a", "js");
      expect(dark).toStartWith("\x1b[38;2;");
      expect(light).toStartWith("\x1b[38;2;");
      expect(dark).not.toBe(light);
      // With 16 colors, both are the terminal's own palette.
      expect(new Theme("dark", { colorDepth: 4 }).ansi("let a", "js")).toBe("\x1b[35mlet\x1b[39m a");
      expect(new Theme("light", { colorDepth: 4 }).ansi("let a", "js")).toBe("\x1b[35mlet\x1b[39m a");
    });

    test("a token takes after its parent", () => {
      const ansi = (styles: Bun.highlight.ThemeStyles) => new Theme(styles, { colorDepth: 24 }).ansi("if", "js");
      expect(ansi({ keyword: "#010203" })).toBe("\x1b[38;2;1;2;3mif\x1b[39m");
      expect(ansi({ keyword: "#010203", "keyword.control": "#040506" })).toBe("\x1b[38;2;4;5;6mif\x1b[39m");
      expect(
        ansi({ keyword: { color: "#010203", bold: true, italic: true }, "keyword.control": { bold: false } }),
      ).toBe("\x1b[38;2;1;2;3;3mif\x1b[39;23m");
    });

    test("underline and strikethrough don't run over blanks", () => {
      const theme = new Theme({ keyword: { underline: true, strikethrough: true } }, { colorDepth: 24 });
      expect(theme.ansi("if if", "js")).toBe("\x1b[4;9mif\x1b[24;29m \x1b[4;9mif\x1b[24;29m");
    });

    test("changing the styles afterwards changes nothing", () => {
      const styles = { keyword: "#010203" };
      const theme = new Theme(styles, { colorDepth: 24 });
      styles.keyword = "#040506";
      expect(theme.ansi("if", "js")).toBe("\x1b[38;2;1;2;3mif\x1b[39m");
    });

    describe("without options", () => {
      const run = async (env: Record<string, string | undefined>) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", `process.stdout.write(JSON.stringify(new Bun.highlight.Theme().ansi("let a", "js")))`],
          env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined, COLORFGBG: undefined, ...env },
          stderr: "inherit",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        return { out: JSON.parse(stdout), exitCode };
      };

      test.concurrent("NO_COLOR turns colors off", async () => {
        expect(await run({ NO_COLOR: "1" })).toEqual({ out: "let a", exitCode: 0 });
      });

      test.concurrent("FORCE_COLOR says how many colors there are", async () => {
        expect(await run({ FORCE_COLOR: "3" })).toEqual({
          out: new Theme("dark", { colorDepth: 24 }).ansi("let a", "js"),
          exitCode: 0,
        });
        expect(await run({ FORCE_COLOR: "1" })).toEqual({ out: "\x1b[35mlet\x1b[39m a", exitCode: 0 });
      });

      test.concurrent("COLORFGBG says whether the background is light", async () => {
        expect(await run({ FORCE_COLOR: "3", COLORFGBG: "0;15" })).toEqual({
          out: new Theme("light", { colorDepth: 24 }).ansi("let a", "js"),
          exitCode: 0,
        });
      });
    });
  });

  describe("css", () => {
    test("your own styles", () => {
      expect(
        new Theme({
          foreground: "white",
          background: "#000",
          keyword: "red",
          "keyword.control": { bold: true },
          comment: { color: "hsl(120 100% 25%)", italic: true, underline: true, strikethrough: true },
          "comment.doc": { italic: false, strikethrough: false },
        }).css(),
      ).toBe(
        ".hl{color:#ffffff;background:#000000;}\n" +
          ".hl-comment{color:#008000;font-style:italic;text-decoration:underline line-through;}\n" +
          ".hl-comment-doc{font-style:normal;text-decoration:underline;}\n" +
          ".hl-keyword{color:#ff0000;}\n" +
          ".hl-keyword-control{font-weight:bold;}\n",
      );
    });

    test("built-in themes", () => {
      const dark = new Theme("dark").css();
      const light = new Theme("light").css();
      expect(dark).toStartWith(".hl{color:#");
      expect(dark).toContain("\n.hl-keyword{color:#");
      expect(dark).not.toBe(light);
      expect(new Theme().css()).toBe(`${light}@media (prefers-color-scheme: dark) {\n${dark}}\n`);
    });

    test("doesn't depend on the number of colors", () => {
      expect(new Theme("dark", { colorDepth: 4 }).css()).toBe(new Theme("dark", { colorDepth: 24 }).css());
    });
  });

  test.each([
    [["solarized"], `The "styles" argument must be "dark", "light" or an object. Received type string ('solarized')`],
    [[1], 'The "styles" argument must be of type string or object'],
    [[null], 'The "styles" argument must be of type string or object'],
    [[{ keywrd: "red" }], '"keywrd" is not a token that a theme can style'],
    [[{ keyword: "not a color" }], 'The property "keyword" is invalid'],
    [[{ keyword: "red blue" }], 'The property "keyword" is invalid'],
    [[{ keyword: 1 }], 'The "keyword" property must be of type string'],
    [[{ keyword: { color: 1 } }], 'The "keyword" property must be of type string'],
    [["dark", 1], 'The "options" argument must be of type object'],
    [["dark", { colorDepth: 2 }], 'The property "colorDepth" is invalid'],
    [["dark", { colorDepth: "24" }], 'The property "colorDepth" is invalid'],
  ])("rejects %j", (args, message) => {
    // @ts-expect-error
    expect(() => new Theme(...args)).toThrow(message);
  });

  test("needs new", () => {
    // @ts-expect-error
    expect(() => Theme()).toThrow();
  });

  test("a getter in the styles can throw", () => {
    const styles = {
      get keyword(): string {
        throw new Error("from the getter");
      },
    };
    expect(() => new Theme(styles)).toThrow("from the getter");
  });

  test("themes are collected", () => {
    for (let i = 0; i < 10_000; i++) new Theme({ keyword: "red" });
    Bun.gc(true);
    expect(new Theme({ keyword: "#010203" }, { colorDepth: 24 }).ansi("if", "js")).toBe("\x1b[38;2;1;2;3mif\x1b[39m");
  });
});

describe("Bun.markdown.ansi", () => {
  test("highlights code blocks in every language", () => {
    const render = (language: string, code: string) =>
      Bun.markdown.ansi("```" + language + "\n" + code + "\n```\n", { colors: true });
    for (const [language, code] of [
      ["ts", "let a: string;"],
      ["css", "a { color: red }"],
      ["json", '{ "a": 1 }'],
      ["yaml", "a: 1"],
    ]) {
      const plain = render("unknown", code);
      const colored = render(language, code);
      expect(stripAnsi(colored).replace(language, "unknown")).toBe(stripAnsi(plain));
      expect(colored.split("\x1b[").length).toBeGreaterThan(plain.split("\x1b[").length);
    }
  });

  test("a token that spans lines stays inside the box", () => {
    const out = Bun.markdown.ansi("```js\n/* a\nb */\n```\n", { colors: true });
    const lines = stripAnsi(out).split("\n");
    expect(lines).toContain("│ /* a");
    expect(lines).toContain("│ b */");
  });
});

describe("fixtures", () => {
  test.each(fixtures)("%s", async file => {
    const code = await Bun.file(join(fixturesDir, file)).text();
    expectIntact(code, languageOf(file));
    expect(annotate(code, languageOf(file))).toMatchSnapshot(basename(file));
  });
});

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
      const depth = 5_000;
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

test("takes time in proportion to the size of the code", async () => {
  const code = await Bun.file(join(fixturesDir, "typescript.ts")).text();
  const time = (copies: number) => {
    const input = Buffer.alloc(code.length * copies, code).toString();
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const start = Bun.nanoseconds();
      Bun.highlight.html(input, "ts");
      best = Math.min(best, Bun.nanoseconds() - start);
    }
    return best;
  };
  time(1);
  // Twice the code should take about twice as long. Quadratic would be four times.
  expect(time(64) / time(32)).toBeLessThan(3);
});

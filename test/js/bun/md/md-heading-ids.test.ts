import { describe, expect, test } from "bun:test";

const Markdown = Bun.markdown;

// ============================================================================
// Heading IDs and Autolink Headings (HTML output)
// ============================================================================

describe("headingIds option", () => {
  test("basic heading gets an id attribute", () => {
    const result = Markdown.html("## Hello World\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="hello-world">Hello World</h2>\n');
  });

  test("heading levels 1-6 all get ids", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Test\n";
      const result = Markdown.html(md, { headings: { ids: true } });
      expect(result).toBe(`<h${i} id="test">Test</h${i}>\n`);
    }
  });

  test("special characters are stripped from slug", () => {
    const result = Markdown.html("## Hello, World!\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="hello-world">Hello, World!</h2>\n');
  });

  test("uppercase is lowercased in slug", () => {
    const result = Markdown.html("## ALLCAPS\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="allcaps">ALLCAPS</h2>\n');
  });

  test("duplicate headings get deduplicated with -N suffix", () => {
    const md = "## Foo\n\n## Foo\n\n## Foo\n";
    const result = Markdown.html(md, { headings: { ids: true } });
    expect(result).toContain('<h2 id="foo">Foo</h2>');
    expect(result).toContain('<h2 id="foo-1">Foo</h2>');
    expect(result).toContain('<h2 id="foo-2">Foo</h2>');
  });

  test("inline markup is stripped from slug", () => {
    const result = Markdown.html("## Hello **World**\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="hello-world">Hello <strong>World</strong></h2>\n');
  });

  test("inline code is included in slug text", () => {
    const result = Markdown.html("## Use `foo()` here\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="use-foo-here">Use <code>foo()</code> here</h2>\n');
  });

  test("hyphens in heading text are preserved", () => {
    const result = Markdown.html("## my-heading-text\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="my-heading-text">my-heading-text</h2>\n');
  });

  test("numbers are kept in slug", () => {
    const result = Markdown.html("## Step 3\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="step-3">Step 3</h2>\n');
  });

  test("empty heading produces empty id", () => {
    const result = Markdown.html("##\n", { headings: { ids: true }, permissiveAtxHeaders: true });
    expect(result).toBe('<h2 id=""></h2>\n');
  });

  test("headingIds defaults to false", () => {
    const result = Markdown.html("## Test\n");
    expect(result).toBe("<h2>Test</h2>\n");
  });

  test("multiple spaces collapse to single hyphen", () => {
    const result = Markdown.html("## hello   world\n", { headings: { ids: true } });
    expect(result).toBe('<h2 id="hello-world">hello   world</h2>\n');
  });

  test("mixed content heading", () => {
    const md = "## Install `bun` on Linux\n";
    const result = Markdown.html(md, { headings: { ids: true } });
    expect(result).toBe('<h2 id="install-bun-on-linux">Install <code>bun</code> on Linux</h2>\n');
  });

  /** The id of each heading of `md`, in document order. */
  function headingIds(md: string | Uint8Array): string[] {
    return Array.from(Markdown.html(md, { headings: { ids: true } }).matchAll(/<h[1-6] id="([^"]*)"/g), m => m[1]);
  }

  /** One document with each key of `headings` as a heading. The values are the ids it has to get. */
  function expectIds(headings: Record<string, string>) {
    const texts = Object.keys(headings);
    const ids = headingIds(texts.map(text => `# ${text}\n`).join("\n"));
    expect(Object.fromEntries(texts.map((text, i) => [text, ids[i]]))).toEqual(headings);
  }

  test("letters outside ASCII stay in the id", () => {
    expectIds({
      "日本語": "日本語",
      "中文": "中文",
      "한국어": "한국어",
      "Привет мир": "привет-мир",
      "Ελληνικά": "ελληνικά",
      "العربية": "العربية",
      "हिन्दी": "हिन्दी",
      "ภาษาไทย": "ภาษาไทย",
      "Tiếng Việt": "tiếng-việt",
      "Über uns": "über-uns",
      "Café": "café",
      "Straße 2": "straße-2",
      "サーバー ２０２４年": "サーバー-２０２４年",
      "**Ünïcödé** `кода` [ссылка](https://example.com)": "ünïcödé-кода-ссылка",
    });
  });

  test("a combining mark stays with its letter", () => {
    expectIds({
      "Cafe\u0301": "cafe\u0301",
      "Tie\u0302\u0301ng Vie\u0323\u0302t": "tie\u0302\u0301ng-vie\u0323\u0302t",
    });
  });

  test("a lowercase form that is longer than its letter", () => {
    expectIds({
      "İstanbul": "i\u0307stanbul",
      "Ⱥ": "ⱥ",
      "ȾȺȾ end": "ⱦⱥⱦ-end",
    });
  });

  test("punctuation, symbols and emoji outside ASCII are stripped from slug", () => {
    expectIds({
      "\u2699\uFE0F Configuration": "configuration",
      "🚀 Quick Start": "quick-start",
      "1\uFE0F\u20E3 Install": "1-install",
      "👨\u200D💻 Developer": "developer",
      "What’s New": "whats-new",
      "Foo — Bar": "foo-bar",
      "E = mc²": "e-mc",
      "日本語\u3000ガイド・入門": "日本語ガイド入門",
      "«Привет», мир…": "привет-мир",
      "می\u200Cخواهم": "میخواهم",
      "Col·lecció": "collecció",
      "snake\uFF3Fcase ＡＢ": "snakecase-ａｂ",
      "Démarrage rapide 🚀": "démarrage-rapide",
    });
  });

  test("bytes that are not UTF-8 are stripped from slug", () => {
    // "# a\xFFb é" and "# Café au lait" in Latin-1
    expect(headingIds(new Uint8Array([0x23, 0x20, 0x61, 0xff, 0x62, 0x20, 0xc3, 0xa9, 0x0a]))).toEqual(["ab-é"]);
    expect(headingIds(Buffer.from("# Caf\xE9 au lait\n", "latin1"))).toEqual(["caf-au-lait"]);
  });

  test("no two headings of one document get the same id", () => {
    expect(headingIds("# Foo\n\n# Foo\n\n# Foo 1\n")).toEqual(["foo", "foo-1", "foo-1-1"]);
    expect(headingIds("# Step 1\n\n# Step\n\n# Step\n")).toEqual(["step-1", "step", "step-2"]);
    expect(headingIds("# a\n\n# a-1\n\n# a\n\n# a\n\n# a-1\n\n# a-1-1\n\n# a-1\n")).toEqual([
      "a",
      "a-1",
      "a-2",
      "a-3",
      "a-1-1",
      "a-1-1-1",
      "a-1-2",
    ]);
    expect(headingIds("# 日本語\n\n# 日本語\n\n# 日本語 1\n")).toEqual(["日本語", "日本語-1", "日本語-1-1"]);
    // "a-01" and "a-2" are not ids of a repeat of "a" when they come.
    expect(headingIds("# a\n\n# a\n\n# a 01\n\n# a 2\n\n# a\n\n# a 3\n")).toEqual([
      "a",
      "a-1",
      "a-01",
      "a-2",
      "a-3",
      "a-3-1",
    ]);
  });

  test("headings with no letter and no digit get different ids", () => {
    expect(headingIds("# !\n\n# ?\n\n# 🚀\n\n# 1\n\n# -1\n")).toEqual(["", "-1", "-2", "1", "1-1"]);
  });

  test("render() and react() get the ids of html()", () => {
    const md = "# 日本語\n\n# Über uns\n\n# Foo\n\n# Foo\n\n# Foo 1\n";
    const ids = ["日本語", "über-uns", "foo", "foo-1", "foo-1-1"];

    const rendered: string[] = [];
    Markdown.render(
      md,
      {
        heading: (_children: string, meta: { id?: string }) => {
          rendered.push(meta.id!);
          return "";
        },
      },
      { headings: { ids: true } },
    );
    const reacted = (Markdown.react(md, undefined, { headings: { ids: true } }).props as { children: any[] }).children;

    expect({ html: headingIds(md), render: rendered, react: reacted.map(el => el.props.id) }).toEqual({
      html: ids,
      render: ids,
      react: ids,
    });
  });
});

describe("autolinkHeadings option", () => {
  test("wraps heading content in anchor tag", () => {
    const result = Markdown.html("## Hello\n", { headings: true });
    expect(result).toBe('<h2 id="hello"><a href="#hello">Hello</a></h2>\n');
  });

  test("anchor wraps all inline content", () => {
    const result = Markdown.html("## Hello **World**\n", { headings: true });
    expect(result).toBe('<h2 id="hello-world"><a href="#hello-world">Hello <strong>World</strong></a></h2>\n');
  });

  test("autolink with deduplication", () => {
    const md = "## Foo\n\n## Foo\n";
    const result = Markdown.html(md, { headings: true });
    expect(result).toContain('<h2 id="foo"><a href="#foo">Foo</a></h2>');
    expect(result).toContain('<h2 id="foo-1"><a href="#foo-1">Foo</a></h2>');
  });

  test("autolink of a heading with letters outside ASCII", () => {
    const result = Markdown.html("## 日本語 ガイド\n", { headings: true });
    expect(result).toBe('<h2 id="日本語-ガイド"><a href="#日本語-ガイド">日本語 ガイド</a></h2>\n');
  });

  test("autolinkHeadings without headingIds has no effect", () => {
    const result = Markdown.html("## Test\n", { headings: { autolink: true } });
    expect(result).toBe("<h2>Test</h2>\n");
  });
});

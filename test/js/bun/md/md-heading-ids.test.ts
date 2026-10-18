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

  // HTML has no link in a link. The heading keeps its id, and its content is what `headings: { ids: true }` gives.
  test.each([
    [
      "an inline link",
      "## See [the docs](https://example.com/a)\n",
      '<h2 id="see-the-docs">See <a href="https://example.com/a">the docs</a></h2>\n',
    ],
    [
      "a reference link",
      "## See [the docs][d]\n\n[d]: https://example.com/a\n",
      '<h2 id="see-the-docs">See <a href="https://example.com/a">the docs</a></h2>\n',
    ],
    [
      "an autolink",
      "## See <https://example.com/a>\n",
      '<h2 id="see-httpsexamplecoma">See <a href="https://example.com/a">https://example.com/a</a></h2>\n',
    ],
    [
      "a www autolink",
      "## Visit www.example.com now\n",
      '<h2 id="visit-wwwexamplecom-now">Visit <a href="http://www.example.com">www.example.com</a> now</h2>\n',
    ],
    [
      "an email autolink",
      "## Mail me@example.com\n",
      '<h2 id="mail-meexamplecom">Mail <a href="mailto:me@example.com">me@example.com</a></h2>\n',
    ],
    [
      "an <a> tag",
      '## See <a href="https://example.com/a">the docs</a>\n',
      '<h2 id="see-the-docs">See <a href="https://example.com/a">the docs</a></h2>\n',
    ],
    [
      "an <A> tag on two lines",
      'See <A\nHREF="https://example.com/a">the docs</A>\n===\n',
      '<h1 id="see-the-docs">See <A\nHREF="https://example.com/a">the docs</A></h1>\n',
    ],
    [
      "a link in emphasis",
      "## **bold [link](https://example.com/a) more** tail\n",
      '<h2 id="bold-link-more-tail"><strong>bold <a href="https://example.com/a">link</a> more</strong> tail</h2>\n',
    ],
    [
      "a link and nothing else",
      "## [the docs](https://example.com/a)\n",
      '<h2 id="the-docs"><a href="https://example.com/a">the docs</a></h2>\n',
    ],
    [
      "a linked image",
      "## [![alt](a.png)](https://example.com/a)\n",
      '<h2 id="alt"><a href="https://example.com/a"><img src="a.png" alt="alt" /></a></h2>\n',
    ],
    [
      "a link, in a setext heading",
      "See [the docs](https://example.com/a)\n===\n",
      '<h1 id="see-the-docs">See <a href="https://example.com/a">the docs</a></h1>\n',
    ],
  ])("a heading with %s gets no link to itself", (_, md, html) => {
    expect(Markdown.html(md, { headings: true, autolinks: true })).toBe(html);
  });

  test.each([
    [
      "an image",
      "## ![alt](a.png) pic\n",
      '<h2 id="alt-pic"><a href="#alt-pic"><img src="a.png" alt="alt" /> pic</a></h2>\n',
    ],
    [
      "a link in the text of an image",
      "## ![a [b](https://example.com/a) c](i.png)\n",
      '<h2 id="a-b-c"><a href="#a-b-c"><img src="i.png" alt="a b c" /></a></h2>\n',
    ],
    [
      "a wiki link",
      "## See [[Page]]\n",
      '<h2 id="see-page"><a href="#see-page">See <x-wikilink data-target="Page">Page</x-wikilink></a></h2>\n',
    ],
    [
      "an <abbr> tag",
      '## The <abbr title="x">API</abbr>\n',
      '<h2 id="the-api"><a href="#the-api">The <abbr title="x">API</abbr></a></h2>\n',
    ],
    [
      "a link before it",
      "[x](https://example.com/a)\n\n## Title\n",
      '<p><a href="https://example.com/a">x</a></p>\n<h2 id="title"><a href="#title">Title</a></h2>\n',
    ],
    [
      "a heading with a link before it",
      "## [a](https://example.com/a)\n\n## b\n",
      '<h2 id="a"><a href="https://example.com/a">a</a></h2>\n<h2 id="b"><a href="#b">b</a></h2>\n',
    ],
  ])("a heading with %s keeps the link to itself", (_, md, html) => {
    expect(Markdown.html(md, { headings: true, wikiLinks: true })).toBe(html);
  });

  test("autolink with deduplication", () => {
    const md = "## Foo\n\n## Foo\n";
    const result = Markdown.html(md, { headings: true });
    expect(result).toContain('<h2 id="foo"><a href="#foo">Foo</a></h2>');
    expect(result).toContain('<h2 id="foo-1"><a href="#foo-1">Foo</a></h2>');
  });

  test("autolinkHeadings without headingIds has no effect", () => {
    const result = Markdown.html("## Test\n", { headings: { autolink: true } });
    expect(result).toBe("<h2>Test</h2>\n");
  });
});

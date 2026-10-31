import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  /** How many `<a>` start tags of `html` are inside another `<a>`, for a tokenizer of HTML. */
  function linksInLinks(html: string): number {
    let open = 0;
    let nested = 0;
    new HTMLRewriter()
      .on("a", {
        element(a) {
          if (open > 0) nested++;
          open++;
          a.onEndTag(() => {
            open--;
          });
        },
      })
      .transform(html);
    return nested;
  }

  // The link to a heading goes around no other link. Such a heading keeps its id, and its content is what
  // `headings: { ids: true }` gives.
  const noLinkToItself: [name: string, md: string, html: string, options?: Bun.markdown.Options][] = [
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
      { autolinks: true },
    ],
    [
      "an email autolink",
      "## Mail me@example.com\n",
      '<h2 id="mail-meexamplecom">Mail <a href="mailto:me@example.com">me@example.com</a></h2>\n',
      { autolinks: true },
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
    // Markdown ends these three at `-->`, `]]>` and `?>`. HTML ends them before the `<a>` tag.
    [
      "an <a> tag after a comment that --!> ends",
      '## Foo <!-- x --!> <a href="u">y</a> --> bar\n',
      '<h2 id="foo-bar">Foo <!-- x --!> <a href="u">y</a> --> bar</h2>\n',
    ],
    [
      "an <a> tag after a > in a CDATA section",
      '## Foo <![CDATA[ > <a href="u">y</a> ]]> bar\n',
      '<h2 id="foo-bar">Foo <![CDATA[ > <a href="u">y</a> ]]> bar</h2>\n',
    ],
    [
      "an <a> tag after a > in a processing instruction",
      '## Foo <? > <a href="u">y</a> ?> bar\n',
      '<h2 id="foo-bar">Foo <? > <a href="u">y</a> ?> bar</h2>\n',
    ],
    [
      "an <a> tag in an attribute of a tag that the tag filter makes text",
      '## Foo <script x="<a href=u>">y</a> bar\n',
      '<h2 id="foo-y-bar">Foo &lt;script x="<a href=u>">y</a> bar</h2>\n',
      { tagFilter: true },
    ],
    // No link for a tokenizer of HTML. The bytes of the heading are what counts.
    [
      "an <a> tag in a comment",
      '## Foo <!-- <a href="u"> --> bar\n',
      '<h2 id="foo-bar">Foo <!-- <a href="u"> --> bar</h2>\n',
    ],
    [
      "an <a> tag in an attribute",
      '## The <abbr title="<a href=u>">API</abbr>\n',
      '<h2 id="the-api">The <abbr title="<a href=u>">API</abbr></h2>\n',
    ],
  ];
  test.each(noLinkToItself)("a heading with %s gets no link to itself", (_, md, html, options = {}) => {
    const result = Markdown.html(md, { headings: true, ...options });
    expect({ result, linksInLinks: linksInLinks(result) }).toEqual({ result: html, linksInLinks: 0 });
  });

  const linkToItself: [name: string, md: string, html: string, options?: Bun.markdown.Options][] = [
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
      { wikiLinks: true },
    ],
    [
      "an <abbr> tag",
      '## The <abbr title="x">API</abbr>\n',
      '<h2 id="the-api"><a href="#the-api">The <abbr title="x">API</abbr></a></h2>\n',
    ],
    [
      "an <a> tag in a code span",
      '## The `<a href="u">` tag\n',
      '<h2 id="the-a-hrefu-tag"><a href="#the-a-hrefu-tag">The <code>&lt;a href=&quot;u&quot;&gt;</code> tag</a></h2>\n',
    ],
    [
      "a link before it",
      "[x](https://example.com/a)\n\n## Title\n",
      '<p><a href="https://example.com/a">x</a></p>\n<h2 id="title"><a href="#title">Title</a></h2>\n',
    ],
    [
      "an <a> tag before it",
      '<a href="https://example.com/a">x</a>\n\n## Title\n',
      '<p><a href="https://example.com/a">x</a></p>\n<h2 id="title"><a href="#title">Title</a></h2>\n',
    ],
    [
      "an <a> tag in a block of HTML before it",
      '<div>\n<a href="https://example.com/a">x</a>\n</div>\n\n## Title\n',
      '<div>\n<a href="https://example.com/a">x</a>\n</div>\n<h2 id="title"><a href="#title">Title</a></h2>\n',
    ],
    [
      "a heading with a link before it",
      "## [a](https://example.com/a)\n\n## b\n",
      '<h2 id="a"><a href="https://example.com/a">a</a></h2>\n<h2 id="b"><a href="#b">b</a></h2>\n',
    ],
  ];
  test.each(linkToItself)("a heading with %s keeps the link to itself", (_, md, html, options = {}) => {
    const result = Markdown.html(md, { headings: true, ...options });
    expect({ result, linksInLinks: linksInLinks(result) }).toEqual({ result: html, linksInLinks: 0 });
  });

  test("headings: true is headings: { ids: true } with a link to each heading that has no link", () => {
    let seed = 1;
    const next = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) % n;
    const pick = (from: string[]) => from[next(from.length)];
    const links = [
      "[docs](https://example.com/a)",
      "[ref][r]",
      "<https://example.com/b>",
      "www.example.com",
      '<a href="/c">raw</a>',
      "**[bold](https://example.com/d)**",
      "[![img](a.png)](https://example.com/e)",
      '<!-- x --!> <a href="/f">late</a> -->',
    ];
    const rest = [
      "alpha",
      "Beta",
      "*em*",
      "**strong**",
      "`code`",
      "![img](a.png)",
      "<abbr>ab</abbr>",
      "<!-- c -->",
      "&amp;",
    ];
    const piece = () => (next(4) === 0 ? pick(links) : pick(rest));
    const line = () => Array.from({ length: 1 + next(4) }, piece).join(" ");

    const wrong: string[] = [];
    for (let doc = 0; doc < 150; doc++) {
      const md =
        Array.from({ length: 1 + next(4) }, () =>
          next(3) === 0 ? line() : `${pick(["#", "##", "###"])} ${line()}`,
        ).join("\n\n") + "\n\n[r]: https://example.com/r\n";
      const options = { autolinks: true, tagFilter: next(2) === 0 };
      const withIds = Markdown.html(md, { ...options, headings: { ids: true } });
      const withLinks = Markdown.html(md, { ...options, headings: true });

      // Each heading of `withIds`: does it have a link, for a tokenizer of HTML?
      const hasLink: boolean[] = [];
      new HTMLRewriter()
        .on("h1, h2, h3", { element: () => void hasLink.push(false) })
        .on("h1 a, h2 a, h3 a", { element: () => void (hasLink[hasLink.length - 1] = true) })
        .transform(withIds);
      const linked = Array.from(withLinks.matchAll(/<h[1-3] id="([^"]*)">(<a href="#\1">)?/g), m => m[2] !== undefined);
      const withoutLinks = withLinks.replace(
        /(<h[1-3] id="([^"]*)">)<a href="#\2">([^]*?)<\/a>(<\/h[1-3]>)/g,
        "$1$3$4",
      );

      if (
        linksInLinks(withLinks) !== linksInLinks(withIds) ||
        withoutLinks !== withIds ||
        !Bun.deepEquals(
          linked,
          hasLink.map(has => !has),
        )
      ) {
        wrong.push(md);
      }
    }
    expect(wrong).toEqual([]);
  });

  // Each example of the spec that is one line is the text of a heading here.
  test.each([
    ["spec.txt", {}],
    ["spec-gfm.txt", {}],
    ["spec-permissive-autolinks.txt", { autolinks: true }],
    ["spec-wiki-links.txt", { wikiLinks: true }],
    ["regressions.txt", {}],
  ] as const)("%s: a heading gets the link to itself when it has no <a> start tag", (file, options) => {
    const spec = readFileSync(join(import.meta.dir, file), "utf8").replace(/\r\n?/g, "\n");
    const examples = Array.from(spec.matchAll(/^`{32} example\n(.*)\n\.$/gm), match =>
      match[1].replaceAll("\u2192", "\t"),
    );

    const wrong: string[] = [];
    for (const example of examples) {
      const md = `<a href="p">p</a> [q](r)\n\n## ${example}\n`;
      const withIds = Markdown.html(md, { ...options, headings: { ids: true } });
      const withLinks = Markdown.html(md, { ...options, headings: true });

      const [, before, id, content] = /^([^]*<h2 id="([^"]*)">)([^]*)<\/h2>\n$/.exec(withIds)!;
      const expected = /<a[ \t\n\r\f\v/>]/i.test(content) ? withIds : `${before}<a href="#${id}">${content}</a></h2>\n`;
      if (withLinks !== expected || linksInLinks(withLinks) !== linksInLinks(withIds)) wrong.push(example);
    }
    expect({ examples: examples.length > 0, wrong }).toEqual({ examples: true, wrong: [] });
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

import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";

const Markdown = Bun.markdown;

/** renderToString the Fragment returned by Markdown.react.
 *  Uses reactVersion: 18 since the project has react-dom@18 installed. */
function reactRender(md: string, opts?: any): string {
  return renderToString(Markdown.react(md, { reactVersion: 18, ...opts }));
}

// ============================================================================
// Heading IDs and Autolink Headings (HTML output)
// ============================================================================

describe("headingIds option", () => {
  test("basic heading gets an id attribute", () => {
    const result = Markdown.html("## Hello World\n", { headingIds: true });
    expect(result).toBe('<h2 id="hello-world">Hello World</h2>\n');
  });

  test("heading levels 1-6 all get ids", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Test\n";
      const result = Markdown.html(md, { headingIds: true });
      expect(result).toBe(`<h${i} id="test">Test</h${i}>\n`);
    }
  });

  test("special characters are stripped from slug", () => {
    const result = Markdown.html("## Hello, World!\n", { headingIds: true });
    expect(result).toBe('<h2 id="hello-world">Hello, World!</h2>\n');
  });

  test("uppercase is lowercased in slug", () => {
    const result = Markdown.html("## ALLCAPS\n", { headingIds: true });
    expect(result).toBe('<h2 id="allcaps">ALLCAPS</h2>\n');
  });

  test("duplicate headings get deduplicated with -N suffix", () => {
    const md = "## Foo\n\n## Foo\n\n## Foo\n";
    const result = Markdown.html(md, { headingIds: true });
    expect(result).toContain('<h2 id="foo">Foo</h2>');
    expect(result).toContain('<h2 id="foo-1">Foo</h2>');
    expect(result).toContain('<h2 id="foo-2">Foo</h2>');
  });

  test("inline markup is stripped from slug", () => {
    const result = Markdown.html("## Hello **World**\n", { headingIds: true });
    expect(result).toBe('<h2 id="hello-world">Hello <strong>World</strong></h2>\n');
  });

  test("inline code is included in slug text", () => {
    const result = Markdown.html("## Use `foo()` here\n", { headingIds: true });
    expect(result).toBe('<h2 id="use-foo-here">Use <code>foo()</code> here</h2>\n');
  });

  test("hyphens in heading text are preserved", () => {
    const result = Markdown.html("## my-heading-text\n", { headingIds: true });
    expect(result).toBe('<h2 id="my-heading-text">my-heading-text</h2>\n');
  });

  test("numbers are kept in slug", () => {
    const result = Markdown.html("## Step 3\n", { headingIds: true });
    expect(result).toBe('<h2 id="step-3">Step 3</h2>\n');
  });

  test("empty heading produces empty id", () => {
    const result = Markdown.html("##\n", { headingIds: true, permissiveAtxHeaders: true });
    expect(result).toBe('<h2 id=""></h2>\n');
  });

  test("headingIds defaults to false", () => {
    const result = Markdown.html("## Test\n");
    expect(result).toBe("<h2>Test</h2>\n");
  });

  test("multiple spaces collapse to single hyphen", () => {
    const result = Markdown.html("## hello   world\n", { headingIds: true });
    expect(result).toBe('<h2 id="hello-world">hello   world</h2>\n');
  });

  test("mixed content heading", () => {
    const md = "## Install `bun` on Linux\n";
    const result = Markdown.html(md, { headingIds: true });
    expect(result).toBe('<h2 id="install-bun-on-linux">Install <code>bun</code> on Linux</h2>\n');
  });
});

describe("autolinkHeadings option", () => {
  test("wraps heading content in anchor tag", () => {
    const result = Markdown.html("## Hello\n", { headingIds: true, autolinkHeadings: true });
    expect(result).toBe('<h2 id="hello"><a href="#hello">Hello</a></h2>\n');
  });

  test("anchor wraps all inline content", () => {
    const result = Markdown.html("## Hello **World**\n", { headingIds: true, autolinkHeadings: true });
    expect(result).toBe('<h2 id="hello-world"><a href="#hello-world">Hello <strong>World</strong></a></h2>\n');
  });

  test("autolink with deduplication", () => {
    const md = "## Foo\n\n## Foo\n";
    const result = Markdown.html(md, { headingIds: true, autolinkHeadings: true });
    expect(result).toContain('<h2 id="foo"><a href="#foo">Foo</a></h2>');
    expect(result).toContain('<h2 id="foo-1"><a href="#foo-1">Foo</a></h2>');
  });

  test("autolinkHeadings without headingIds has no effect", () => {
    const result = Markdown.html("## Test\n", { autolinkHeadings: true });
    expect(result).toBe("<h2>Test</h2>\n");
  });
});

// ============================================================================
// Bun.markdown.render() — callback-based string renderer
// ============================================================================

describe("Bun.markdown.render", () => {
  test("returns a string", () => {
    const result = Markdown.render("# Hello\n", {
      heading: (children: string) => `<h1>${children}</h1>`,
    });
    expect(typeof result).toBe("string");
  });

  test("without callbacks, children pass through unchanged", () => {
    const result = Markdown.render("Hello world\n");
    expect(result).toBe("Hello world");
  });

  test("heading callback with level metadata", () => {
    const result = Markdown.render("# Hello\n", {
      heading: (children: string, { level }: any) => `<h${level}>${children}</h${level}>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("<h1>Hello</h1>");
  });

  test("heading levels 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Level\n";
      const result = Markdown.render(md, {
        heading: (children: string, { level }: any) => `[h${level}:${children}]`,
      });
      expect(result).toBe(`[h${i}:Level]`);
    }
  });

  test("paragraph callback", () => {
    const result = Markdown.render("Hello world\n", {
      paragraph: (children: string) => `<p>${children}</p>`,
    });
    expect(result).toBe("<p>Hello world</p>");
  });

  test("strong callback", () => {
    const result = Markdown.render("**bold**\n", {
      strong: (children: string) => `<b>${children}</b>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("<b>bold</b>");
  });

  test("emphasis callback", () => {
    const result = Markdown.render("*italic*\n", {
      emphasis: (children: string) => `<i>${children}</i>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("<i>italic</i>");
  });

  test("link callback with href metadata", () => {
    const result = Markdown.render("[click](https://example.com)\n", {
      link: (children: string, { href }: any) => `<a href="${href}">${children}</a>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<a href="https://example.com">click</a>');
  });

  test("link callback with title metadata", () => {
    const result = Markdown.render('[click](https://example.com "My Title")\n', {
      link: (children: string, { href, title }: any) => `<a href="${href}" title="${title}">${children}</a>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<a href="https://example.com" title="My Title">click</a>');
  });

  test("image callback with src metadata", () => {
    const result = Markdown.render("![alt text](image.png)\n", {
      image: (children: string, { src }: any) => `<img src="${src}" alt="${children}" />`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<img src="image.png" alt="alt text" />');
  });

  test("code block callback with language metadata", () => {
    const result = Markdown.render("```js\nconsole.log('hi');\n```\n", {
      code: (children: string, meta: any) => `<pre lang="${meta?.language}">${children}</pre>`,
    });
    expect(result).toBe("<pre lang=\"js\">console.log('hi');\n</pre>");
  });

  test("code block without language", () => {
    const result = Markdown.render("```\nplain code\n```\n", {
      code: (children: string, meta: any) => `<pre lang="${meta?.language ?? "none"}">${children}</pre>`,
    });
    expect(result).toBe('<pre lang="none">plain code\n</pre>');
  });

  test("codespan callback", () => {
    const result = Markdown.render("`code`\n", {
      codespan: (children: string) => `<code>${children}</code>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("<code>code</code>");
  });

  test("hr callback", () => {
    const result = Markdown.render("---\n", {
      hr: () => "<hr />",
    });
    expect(result).toBe("<hr />");
  });

  test("blockquote callback", () => {
    const result = Markdown.render("> quoted text\n", {
      blockquote: (children: string) => `<blockquote>${children}</blockquote>`,
      paragraph: (children: string) => `<p>${children}</p>`,
    });
    expect(result).toBe("<blockquote><p>quoted text</p></blockquote>");
  });

  test("list callbacks (ordered)", () => {
    const result = Markdown.render("1. first\n2. second\n", {
      list: (children: string, { ordered, start }: any) =>
        ordered ? `<ol start="${start}">${children}</ol>` : `<ul>${children}</ul>`,
      listItem: (children: string) => `<li>${children}</li>`,
    });
    expect(result).toBe('<ol start="1"><li>first</li><li>second</li></ol>');
  });

  test("list callbacks (unordered)", () => {
    const result = Markdown.render("- a\n- b\n", {
      list: (children: string, { ordered }: any) => (ordered ? `<ol>${children}</ol>` : `<ul>${children}</ul>`),
      listItem: (children: string) => `<li>${children}</li>`,
    });
    expect(result).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  test("ordered list with start number", () => {
    const result = Markdown.render("3. first\n4. second\n", {
      list: (children: string, { start }: any) => `<ol start="${start}">${children}</ol>`,
      listItem: (children: string) => `<li>${children}</li>`,
    });
    expect(result).toBe('<ol start="3"><li>first</li><li>second</li></ol>');
  });

  test("strikethrough callback", () => {
    const result = Markdown.render("~~deleted~~\n", {
      strikethrough: (children: string) => `<del>${children}</del>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("<del>deleted</del>");
  });

  test("text callback", () => {
    const result = Markdown.render("Hello world\n", {
      text: (text: string) => text.toUpperCase(),
      paragraph: (children: string) => children,
    });
    expect(result).toBe("HELLO WORLD");
  });

  test("returning null omits element", () => {
    const result = Markdown.render("# Title\n\n![logo](img.png)\n\nHello\n", {
      image: () => null,
      heading: (children: string) => children,
      paragraph: (children: string) => children + "\n",
    });
    expect(result).toBe("Title\nHello\n");
  });

  test("returning undefined omits element", () => {
    const result = Markdown.render("# Title\n\nHello\n", {
      heading: () => undefined,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("Hello");
  });

  test("multiple callbacks combined", () => {
    const result = Markdown.render("# Title\n\nHello **world**\n", {
      heading: (children: string, { level }: any) => `<h${level} class="heading">${children}</h${level}>`,
      paragraph: (children: string) => `<p class="body">${children}</p>`,
      strong: (children: string) => `<strong class="bold">${children}</strong>`,
    });
    expect(result).toBe('<h1 class="heading">Title</h1><p class="body">Hello <strong class="bold">world</strong></p>');
  });

  test("stripping all formatting", () => {
    const result = Markdown.render("# Hello **world**\n", {
      heading: (children: string) => children,
      paragraph: (children: string) => children,
      strong: (children: string) => children,
      emphasis: (children: string) => children,
      link: (children: string) => children,
      image: () => "",
      code: (children: string) => children,
      codespan: (children: string) => children,
    });
    expect(result).toBe("Hello world");
  });

  test("ANSI terminal output", () => {
    const result = Markdown.render("# Hello\n\nThis is **bold** and *italic*\n", {
      heading: (children: string) => `\x1b[1;4m${children}\x1b[0m\n`,
      paragraph: (children: string) => children + "\n",
      strong: (children: string) => `\x1b[1m${children}\x1b[22m`,
      emphasis: (children: string) => `\x1b[3m${children}\x1b[23m`,
    });
    expect(result).toBe("\x1b[1;4mHello\x1b[0m\nThis is \x1b[1mbold\x1b[22m and \x1b[3mitalic\x1b[23m\n");
  });

  test("parser options work alongside callbacks", () => {
    const result = Markdown.render("Visit www.example.com\n", {
      link: (children: string, { href }: any) => `[${children}](${href})`,
      paragraph: (children: string) => children,
      permissiveAutolinks: true,
    });
    expect(result).toContain("[www.example.com]");
  });

  test("headingIds option provides id in heading meta", () => {
    const result = Markdown.render("## Hello World\n", {
      heading: (children: string, { level, id }: any) => `<h${level} id="${id}">${children}</h${level}>`,
      headingIds: true,
    });
    expect(result).toBe('<h2 id="hello-world">Hello World</h2>');
  });

  test("table callbacks", () => {
    const result = Markdown.render("| A | B |\n|---|---|\n| 1 | 2 |\n", {
      table: (children: string) => `<table>${children}</table>`,
      thead: (children: string) => `<thead>${children}</thead>`,
      tbody: (children: string) => `<tbody>${children}</tbody>`,
      tr: (children: string) => `<tr>${children}</tr>`,
      th: (children: string) => `<th>${children}</th>`,
      td: (children: string) => `<td>${children}</td>`,
    });
    expect(result).toContain("<table>");
    expect(result).toContain("<th>A</th>");
    expect(result).toContain("<td>1</td>");
  });

  test("entities are decoded", () => {
    const result = Markdown.render("&amp;\n", {
      paragraph: (children: string) => children,
    });
    expect(result).toBe("&");
  });
});

// ============================================================================
// Bun.markdown.react() — React element AST
// ============================================================================

describe("Bun.markdown.react", () => {
  const REACT_ELEMENT_SYMBOL = Symbol.for("react.element");
  const REACT_FRAGMENT_SYMBOL = Symbol.for("react.fragment");
  const REACT_TRANSITIONAL_SYMBOL = Symbol.for("react.transitional.element");

  /** Helper: get the children array from the Fragment returned by react() */
  function children(md: string, opts?: any): any[] {
    return Markdown.react(md, opts).props.children;
  }

  test("returns a Fragment element", () => {
    const result = Markdown.react("# Hello\n");
    expect(result.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(result.type).toBe(REACT_FRAGMENT_SYMBOL);
    expect(result.key).toBeNull();
    expect(result.ref).toBeNull();
    expect(result.props.children).toBeArray();
  });

  test("fragment children are React elements", () => {
    const els = children("# Hello\n");
    expect(els).toHaveLength(1);
    expect(els[0].$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
  });

  test("element has type, key, ref, props", () => {
    const el = children("# Hello\n")[0];
    expect(el.type).toBe("h1");
    expect(el.key).toBeNull();
    expect(el.ref).toBeNull();
    expect(el.props).toEqual({ children: ["Hello"] });
  });

  test("heading levels 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Level\n";
      const el = children(md)[0];
      expect(el.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
      expect(el.type).toBe(`h${i}`);
      expect(el.props.children).toEqual(["Level"]);
    }
  });

  test("text is plain strings in children", () => {
    expect(children("Hello world\n")[0].props.children).toEqual(["Hello world"]);
  });

  test("nested inline elements are React elements", () => {
    const p = children("Hello **world**\n")[0];
    expect(p.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(p.props.children[0]).toBe("Hello ");
    const strong = p.props.children[1];
    expect(strong.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(strong.type).toBe("strong");
    expect(strong.props.children).toEqual(["world"]);
  });

  test("link has href in props", () => {
    const link = children("[click](https://example.com)\n")[0].props.children[0];
    expect(link.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(link.type).toBe("a");
    expect(link.props.href).toBe("https://example.com");
    expect(link.props.children).toEqual(["click"]);
  });

  test("image has src and alt in props", () => {
    const img = children("![alt](img.png)\n")[0].props.children[0];
    expect(img.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(img.type).toBe("img");
    expect(img.props.src).toBe("img.png");
    expect(img.props.alt).toBe("alt");
    expect(img.props.children).toBeUndefined();
  });

  test("code block with language", () => {
    const pre = children("```ts\nconst x = 1;\n```\n")[0];
    expect(pre.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(pre.type).toBe("pre");
    expect(pre.props.language).toBe("ts");
  });

  test("hr is void element", () => {
    const hr = children("---\n")[0];
    expect(hr.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(hr.type).toBe("hr");
    expect(hr.key).toBeNull();
    expect(hr.ref).toBeNull();
    expect(hr.props).toEqual({});
  });

  test("br produces React element", () => {
    const pChildren = children("line1  \nline2\n")[0].props.children;
    const br = pChildren.find((c: any) => typeof c === "object" && c?.type === "br");
    expect(br).toBeDefined();
    expect(br.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(br.props).toEqual({});
  });

  test("ordered list with start", () => {
    const ol = children("3. first\n4. second\n")[0];
    expect(ol.type).toBe("ol");
    expect(ol.props.start).toBe(3);
    expect(ol.props.children).toHaveLength(2);
    expect(ol.props.children[0].type).toBe("li");
  });

  test("table structure", () => {
    const table = children("| A | B |\n|---|---|\n| 1 | 2 |\n")[0];
    expect(table.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(table.type).toBe("table");
    const thead = table.props.children.find((c: any) => c.type === "thead");
    expect(thead).toBeDefined();
    expect(thead.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
  });

  test("headingIds adds id to props", () => {
    const el = children("## Hello World\n", { headingIds: true })[0];
    expect(el.type).toBe("h2");
    expect(el.props.id).toBe("hello-world");
    expect(el.props.children).toEqual(["Hello World"]);
  });

  test("default $$typeof is react.transitional.element", () => {
    const result = Markdown.react("# Hi\n");
    expect(result.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(result.props.children[0].$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
  });

  test("reactVersion 18 uses react.element symbol on all elements", () => {
    const result = Markdown.react("Hello **world**\n", { reactVersion: 18 });
    expect(result.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    const p = result.props.children[0];
    expect(p.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    const strong = p.props.children[1];
    expect(strong.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
  });

  test("multiple blocks", () => {
    const els = children("# Title\n\nParagraph\n");
    expect(els).toHaveLength(2);
    expect(els[0].$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(els[0].type).toBe("h1");
    expect(els[1].$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(els[1].type).toBe("p");
  });

  test("complete document", () => {
    const els = children(`# Hello

This is **bold** and *italic*.

- item one
- item two

---
`);
    expect(els[0].type).toBe("h1");
    expect(els[1].type).toBe("p");
    expect(els[2].type).toBe("ul");
    expect(els[3].type).toBe("hr");
    for (const el of els) {
      expect(el.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    }
  });

  test("blockquote contains nested React elements", () => {
    const bq = children("> quoted text\n")[0];
    expect(bq.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(bq.type).toBe("blockquote");
    const p = bq.props.children[0];
    expect(p.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(p.type).toBe("p");
    expect(p.props.children).toEqual(["quoted text"]);
  });

  test("deeply nested elements are all React elements", () => {
    const bq = children("> **bold *and italic***\n")[0];
    expect(bq.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    const p = bq.props.children[0];
    expect(p.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    const strong = p.props.children[0];
    expect(strong.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(strong.type).toBe("strong");
    const em = strong.props.children[1];
    expect(em.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(em.type).toBe("em");
    expect(em.props.children).toEqual(["and italic"]);
  });

  test("link with title in React element", () => {
    const link = children('[text](https://example.com "My Title")\n')[0].props.children[0];
    expect(link.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(link.type).toBe("a");
    expect(link.props.href).toBe("https://example.com");
    expect(link.props.title).toBe("My Title");
    expect(link.props.children).toEqual(["text"]);
  });

  test("image with title in React element", () => {
    const img = children('![alt](pic.jpg "Photo")\n')[0].props.children[0];
    expect(img.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(img.type).toBe("img");
    expect(img.props.src).toBe("pic.jpg");
    expect(img.props.title).toBe("Photo");
    expect(img.props.alt).toBe("alt");
    expect(img.props.children).toBeUndefined();
  });

  test("inline code is a React element", () => {
    const code = children("`code`\n")[0].props.children[0];
    expect(code.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(code.type).toBe("code");
    expect(code.props.children).toEqual(["code"]);
  });

  test("strikethrough is a React element", () => {
    const del = children("~~deleted~~\n")[0].props.children[0];
    expect(del.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(del.type).toBe("del");
    expect(del.props.children).toEqual(["deleted"]);
  });

  test("unordered list children are React elements", () => {
    const ul = children("- a\n- b\n")[0];
    expect(ul.type).toBe("ul");
    for (const li of ul.props.children) {
      expect(li.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
      expect(li.type).toBe("li");
    }
  });

  test("entities are decoded in React output", () => {
    const text = children("&amp; &lt; &gt;\n")[0].props.children.join("");
    expect(text).toContain("&");
    expect(text).toContain("<");
    expect(text).toContain(">");
  });

  test("softbr becomes newline string", () => {
    const pChildren = children("line1\nline2\n")[0].props.children;
    expect(pChildren).toContain("\n");
  });
});

// ============================================================================
// Bun.markdown.react() + React renderToString integration
// ============================================================================

describe("Bun.markdown.react renderToString", () => {
  test("heading", () => {
    expect(reactRender("# Hello\n")).toBe("<h1>Hello</h1>");
  });

  test("heading levels 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Level\n";
      expect(reactRender(md)).toBe(`<h${i}>Level</h${i}>`);
    }
  });

  test("paragraph", () => {
    expect(reactRender("Hello world\n")).toBe("<p>Hello world</p>");
  });

  test("bold text", () => {
    expect(reactRender("**bold**\n")).toBe("<p><strong>bold</strong></p>");
  });

  test("italic text", () => {
    expect(reactRender("*italic*\n")).toBe("<p><em>italic</em></p>");
  });

  test("nested bold and italic", () => {
    expect(reactRender("**bold *and italic***\n")).toBe("<p><strong>bold <em>and italic</em></strong></p>");
  });

  test("strikethrough", () => {
    expect(reactRender("~~deleted~~\n")).toBe("<p><del>deleted</del></p>");
  });

  test("inline code", () => {
    expect(reactRender("`code`\n")).toBe("<p><code>code</code></p>");
  });

  test("link", () => {
    expect(reactRender("[click](https://example.com)\n")).toBe('<p><a href="https://example.com">click</a></p>');
  });

  test("link with title", () => {
    expect(reactRender('[click](https://example.com "title")\n')).toBe(
      '<p><a href="https://example.com" title="title">click</a></p>',
    );
  });

  test("image", () => {
    expect(reactRender("![alt](img.png)\n")).toBe('<p><img src="img.png" alt="alt"/></p>');
  });

  test("hr", () => {
    expect(reactRender("---\n")).toBe("<hr/>");
  });

  test("br", () => {
    const html = reactRender("line1  \nline2\n");
    expect(html).toContain("<br/>");
    expect(html).toContain("line1");
    expect(html).toContain("line2");
  });

  test("blockquote", () => {
    expect(reactRender("> quoted\n")).toBe("<blockquote><p>quoted</p></blockquote>");
  });

  test("unordered list", () => {
    expect(reactRender("- a\n- b\n")).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  test("ordered list", () => {
    expect(reactRender("1. a\n2. b\n")).toBe('<ol start="1"><li>a</li><li>b</li></ol>');
  });

  test("ordered list with start", () => {
    const html = reactRender("3. a\n4. b\n");
    expect(html).toContain('<ol start="3">');
  });

  test("table", () => {
    const html = reactRender("| A | B |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  test("mixed document", () => {
    const html = reactRender(`# Title

Hello **world**, this is *important*.

- item one
- item two
`);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<em>important</em>");
    expect(html).toContain("<li>item one</li>");
    expect(html).toContain("<li>item two</li>");
  });

  test("entities are decoded", () => {
    const html = reactRender("&amp; &lt; &gt;\n");
    expect(html).toContain("&amp;"); // React re-escapes & in output
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
  });

  test("headingIds produce id attribute", () => {
    const html = reactRender("## Hello World\n", { headingIds: true });
    expect(html).toBe('<h2 id="hello-world">Hello World</h2>');
  });

  test("code block renders as pre", () => {
    const html = reactRender("```\ncode here\n```\n");
    expect(html).toContain("<pre>");
    expect(html).toContain("code here");
  });

  test("nested blockquote with formatting", () => {
    const html = reactRender("> **bold** in quote\n");
    expect(html).toBe("<blockquote><p><strong>bold</strong> in quote</p></blockquote>");
  });

  test("link inside heading", () => {
    const html = reactRender("# [Bun](https://bun.sh)\n");
    expect(html).toBe('<h1><a href="https://bun.sh">Bun</a></h1>');
  });

  test("multiple paragraphs", () => {
    const html = reactRender("First paragraph.\n\nSecond paragraph.\n");
    expect(html).toBe("<p>First paragraph.</p><p>Second paragraph.</p>");
  });

  test("reactVersion 18 produces correct structure", () => {
    const result = Markdown.react("# Hello\n", { reactVersion: 18 });
    const els = result.props.children;
    expect(els[0].type).toBe("h1");
    expect(els[0].props.children).toEqual(["Hello"]);
  });
});

// ============================================================================
// Component overrides (render + react)
// ============================================================================

// (render() is callback-based, component overrides are only for react())

describe("Bun.markdown.react component overrides", () => {
  const REACT_TRANSITIONAL_SYMBOL = Symbol.for("react.transitional.element");
  const REACT_ELEMENT_SYMBOL = Symbol.for("react.element");

  /** Helper: get fragment children */
  function children(md: string, opts?: any): any[] {
    return Markdown.react(md, opts).props.children;
  }

  test("function component override replaces type", () => {
    function MyHeading({ children }: any) {
      return React.createElement("div", { className: "heading" }, ...children);
    }
    const el = children("# Hello\n", { h1: MyHeading })[0];
    expect(el.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(el.type).toBe(MyHeading);
    expect(el.props.children).toEqual(["Hello"]);
  });

  test("string override in react mode", () => {
    const el = children("# Hello\n", { h1: "section" })[0];
    expect(el.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(el.type).toBe("section");
    expect(el.props.children).toEqual(["Hello"]);
  });

  test("multiple component overrides", () => {
    function P({ children }: any) {
      return React.createElement("div", null, ...children);
    }
    function Strong({ children }: any) {
      return React.createElement("b", null, ...children);
    }
    const els = children("Hello **world**\n", { p: P, strong: Strong });
    expect(els[0].type).toBe(P);
    const strong = els[0].props.children[1];
    expect(strong.type).toBe(Strong);
  });

  test("boolean override is ignored in react mode", () => {
    expect(children("# Hello\n", { h1: true })[0].type).toBe("h1");
  });

  test("override with reactVersion 18", () => {
    const el = children("# Hello\n", { h1: "custom-h1", reactVersion: 18 })[0];
    expect(el.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(el.type).toBe("custom-h1");
  });

  test("link override preserves href prop", () => {
    function Link({ href, children }: any) {
      return React.createElement("a", { href, className: "custom" }, ...children);
    }
    const link = children("[click](https://example.com)\n", { a: Link })[0].props.children[0];
    expect(link.type).toBe(Link);
    expect(link.props.href).toBe("https://example.com");
  });

  test("image override preserves src and alt props", () => {
    function Img(props: any) {
      return React.createElement("img", props);
    }
    const img = children("![photo](pic.jpg)\n", { img: Img })[0].props.children[0];
    expect(img.type).toBe(Img);
    expect(img.props.src).toBe("pic.jpg");
    expect(img.props.alt).toBe("photo");
  });

  test("hr override in react mode", () => {
    const el = children("---\n", { hr: "custom-hr" })[0];
    expect(el.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    expect(el.type).toBe("custom-hr");
    expect(el.props).toEqual({});
  });
});

describe("Bun.markdown.react renderToString with component overrides", () => {
  test("function component renders custom HTML", () => {
    function Heading({ children }: any) {
      return React.createElement("div", { className: "title" }, ...children);
    }
    const html = reactRender("# Hello\n", { h1: Heading });
    expect(html).toBe('<div class="title">Hello</div>');
  });

  test("multiple custom components", () => {
    function P({ children }: any) {
      return React.createElement("section", null, ...children);
    }
    function Strong({ children }: any) {
      return React.createElement("b", null, ...children);
    }
    const html = reactRender("Hello **world**\n", { p: P, strong: Strong });
    expect(html).toBe("<section>Hello <b>world</b></section>");
  });

  test("custom link component", () => {
    function Link({ href, children }: any) {
      return React.createElement("a", { href, target: "_blank" }, ...children);
    }
    const html = reactRender("[click](https://example.com)\n", { a: Link });
    expect(html).toBe('<p><a href="https://example.com" target="_blank">click</a></p>');
  });

  test("custom image component", () => {
    function Img({ src, alt }: any) {
      return React.createElement("figure", null, React.createElement("img", { src, alt }));
    }
    const html = reactRender("![photo](pic.jpg)\n", { img: Img });
    expect(html).toBe('<p><figure><img src="pic.jpg" alt="photo"/></figure></p>');
  });

  test("custom code block with language", () => {
    function Code({ language, children }: any) {
      return React.createElement("pre", { "data-lang": language || "text" }, ...children);
    }
    const html = reactRender("```js\nconst x = 1;\n```\n", { pre: Code });
    expect(html).toContain('data-lang="js"');
    expect(html).toContain("const x = 1;");
  });

  test("custom list components", () => {
    function List({ children }: any) {
      return React.createElement("div", { className: "list" }, ...children);
    }
    function Item({ children }: any) {
      return React.createElement("span", null, ...children);
    }
    const html = reactRender("- a\n- b\n", { ul: List, li: Item });
    expect(html).toBe('<div class="list"><span>a</span><span>b</span></div>');
  });

  test("override only specific elements", () => {
    function H1({ children }: any) {
      return React.createElement("h1", { className: "big" }, ...children);
    }
    const html = reactRender("# Title\n\nParagraph\n", { h1: H1 });
    expect(html).toBe('<h1 class="big">Title</h1><p>Paragraph</p>');
  });
});

// ============================================================================
// Fuzzer-like tests: edge cases, pathological inputs, invariant checks
// ============================================================================

describe("fuzzer-like edge cases", () => {
  // ---- Empty / whitespace-only inputs ----

  test("empty string produces empty output across all APIs", () => {
    expect(Markdown.html("")).toBe("");
    expect(Markdown.render("", {})).toBe("");
    const el = Markdown.react("", { reactVersion: 18 });
    expect(renderToString(el)).toBe("");
  });

  test("whitespace-only inputs", () => {
    for (const ws of [" ", "\t", "\n", "\r\n", "   \n\t  \n\n"]) {
      expect(typeof Markdown.html(ws)).toBe("string");
      expect(typeof Markdown.render(ws, {})).toBe("string");
      Markdown.react(ws, { reactVersion: 18 }); // should not throw
    }
  });

  // ---- Null bytes and control characters ----

  test("null bytes are replaced with U+FFFD", () => {
    const html = Markdown.html("a\0b\n");
    expect(html).toContain("\uFFFD");
  });

  test("input with many null bytes does not crash", () => {
    const input = Buffer.alloc(200, "\0").toString();
    expect(typeof Markdown.html(input)).toBe("string");
    expect(typeof Markdown.render(input, {})).toBe("string");
    Markdown.react(input, { reactVersion: 18 });
  });

  test("control characters in input", () => {
    const ctrl =
      "\x01\x02\x03\x04\x05\x06\x07\x08\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f";
    expect(typeof Markdown.html(ctrl)).toBe("string");
  });

  // ---- Binary / non-UTF8 ----

  test("Buffer input works", () => {
    const buf = Buffer.from("# Hello\n");
    expect(Markdown.html(buf)).toContain("<h1>");
  });

  test("binary-ish buffer does not crash", () => {
    const buf = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) buf[i] = i;
    expect(typeof Markdown.html(buf)).toBe("string");
  });

  // ---- Deeply nested structures ----

  test("deeply nested blockquotes", () => {
    const depth = 100;
    const input = Buffer.alloc(depth, "> ").toString() + "deep\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("deeply nested lists", () => {
    let input = "";
    for (let i = 0; i < 50; i++) {
      input += Buffer.alloc(i * 2, " ").toString() + "- item\n";
    }
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("deeply nested emphasis", () => {
    const depth = 50;
    const open = Buffer.alloc(depth, "*").toString();
    const close = open;
    const input = open + "text" + close + "\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("deeply nested links", () => {
    let input = "";
    for (let i = 0; i < 30; i++) {
      input += "[";
    }
    input += "text";
    for (let i = 0; i < 30; i++) {
      input += "](url)";
    }
    input += "\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  // ---- Long inputs ----

  test("very long single line", () => {
    const input = Buffer.alloc(100_000, "a").toString() + "\n";
    const result = Markdown.html(input);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(100_000);
  });

  test("many short lines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      lines.push("line " + i);
    }
    const input = lines.join("\n") + "\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("long heading text for slug generation", () => {
    const longTitle = Buffer.alloc(10_000, "x").toString();
    const input = "# " + longTitle + "\n";
    const result = Markdown.html(input, { headingIds: true });
    expect(result).toContain("id=");
  });

  // ---- Pathological patterns ----

  test("many unclosed brackets", () => {
    const input = Buffer.alloc(500, "[").toString() + "\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("many unclosed parentheses after link", () => {
    const input = "[text](" + Buffer.alloc(500, "(").toString() + "\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("alternating backticks", () => {
    const input = Buffer.alloc(1000, "`a").toString() + "\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("many consecutive heading markers", () => {
    const input = Buffer.alloc(500, "# ").toString() + "text\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("many consecutive horizontal rules", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push("---");
    }
    expect(typeof Markdown.html(lines.join("\n") + "\n")).toBe("string");
  });

  test("table with many columns", () => {
    const cols = 100;
    const header = "|" + Buffer.alloc(cols, "h|").toString();
    const sep = "|" + Buffer.alloc(cols, "-|").toString();
    const row = "|" + Buffer.alloc(cols, "d|").toString();
    const input = header + "\n" + sep + "\n" + row + "\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("table with many rows", () => {
    const lines = ["| a | b |", "| - | - |"];
    for (let i = 0; i < 1000; i++) {
      lines.push("| x | y |");
    }
    expect(typeof Markdown.html(lines.join("\n") + "\n")).toBe("string");
  });

  // ---- HTML injection patterns ----

  test("script tags are passed through or filtered", () => {
    const input = '<script>alert("xss")</script>\n';
    // with tagFilter enabled, disallowed tags should be escaped
    const filtered = Markdown.html(input, { tagFilter: true });
    expect(filtered).not.toContain("<script>");
  });

  test("nested HTML entities", () => {
    const input = "&amp;amp;amp;amp;\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  // ---- Option combinations ----

  const allOptions = {
    tables: true,
    strikethrough: true,
    tasklists: true,
    tagFilter: true,
    permissiveAutolinks: true,
    permissiveUrlAutolinks: true,
    permissiveWwwAutolinks: true,
    permissiveEmailAutolinks: true,
    hardSoftBreaks: true,
    wikiLinks: true,
    underline: true,
    latexMath: true,
    collapseWhitespace: true,
    permissiveAtxHeaders: true,
    noIndentedCodeBlocks: true,
    noHtmlBlocks: true,
    noHtmlSpans: true,
    headingIds: true,
    autolinkHeadings: true,
  };

  test("all options enabled simultaneously", () => {
    const input = `# Heading

**bold** *italic* ~~strike~~ __underline__

- [x] task
- [ ] unchecked

| a | b |
| - | - |
| 1 | 2 |

$E=mc^2$

$$
\\int_0^1 x^2 dx
$$

[[wiki link]]

www.example.com
user@example.com
https://example.com

\`\`\`js
code
\`\`\`

---
`;
    const result = Markdown.html(input, allOptions);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("all options work with render()", () => {
    const input = "# Hello **world**\n";
    const result = Markdown.render(input, {
      heading: (c: string, m: any) => `[H${m.level}:${c}]`,
      strong: (c: string) => `[B:${c}]`,
      ...allOptions,
    });
    expect(result).toContain("[H1:");
    expect(result).toContain("[B:world]");
  });

  test("all options work with react()", () => {
    const input = "# Hello **world**\n";
    const el = Markdown.react(input, { reactVersion: 18, ...allOptions });
    const html = renderToString(el);
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>");
  });

  // ---- Invariant checks ----

  test("html() always returns a string", () => {
    const inputs = [
      "",
      "   ",
      "\n",
      "# H\n",
      "```\ncode\n```\n",
      "| a |\n| - |\n| b |\n",
      "> quote\n",
      "- list\n",
      "1. ordered\n",
      "![img](url)\n",
      "[link](url)\n",
      "**bold**\n",
      "*italic*\n",
      "~~strike~~\n",
      "`code`\n",
      "---\n",
      "<div>html</div>\n",
      "&amp;\n",
    ];
    for (const input of inputs) {
      const result = Markdown.html(input);
      expect(typeof result).toBe("string");
    }
  });

  test("render() always returns a string", () => {
    const inputs = ["", "# H\n", "**b**\n", "[l](u)\n", "```\nc\n```\n"];
    for (const input of inputs) {
      const result = Markdown.render(input, {});
      expect(typeof result).toBe("string");
    }
  });

  test("render() with all callbacks returning null produces empty string", () => {
    const nullCb = () => null;
    const result = Markdown.render("# Hello **world**\n\nParagraph\n", {
      heading: nullCb,
      paragraph: nullCb,
      strong: nullCb,
      text: nullCb,
    });
    expect(result).toBe("");
  });

  test("render() with all callbacks returning empty string", () => {
    const emptyCb = () => "";
    const result = Markdown.render("# Hello\n\nWorld\n", {
      heading: emptyCb,
      paragraph: emptyCb,
    });
    expect(result).toBe("");
  });

  // ---- Callback error handling ----

  test("render() callback that throws propagates the error", () => {
    expect(() => {
      Markdown.render("# Hello\n", {
        heading: () => {
          throw new Error("callback error");
        },
      });
    }).toThrow("callback error");
  });

  test("react() component override that throws propagates during render", () => {
    // Component overrides are used as element types, so they throw during
    // renderToString, not during Markdown.react() itself.
    expect(() => {
      renderToString(
        Markdown.react("# Hello\n", {
          reactVersion: 18,
          h1: () => {
            throw new Error("component error");
          },
        }),
      );
    }).toThrow("component error");
  });

  // ---- Invalid argument types ----

  test("html() with non-string/buffer throws TypeError", () => {
    expect(() => Markdown.html(123 as any)).toThrow();
    expect(() => Markdown.html(null as any)).toThrow();
    expect(() => Markdown.html(undefined as any)).toThrow();
    expect(() => Markdown.html({} as any)).toThrow();
  });

  test("render() with non-string/buffer throws TypeError", () => {
    expect(() => Markdown.render(123 as any, {})).toThrow();
    expect(() => Markdown.render(null as any, {})).toThrow();
  });

  test("react() with non-string/buffer throws TypeError", () => {
    expect(() => Markdown.react(123 as any)).toThrow();
    expect(() => Markdown.react(null as any)).toThrow();
  });

  // ---- Emoji and Unicode ----

  test("emoji in markdown", () => {
    const input = "# Hello \u{1F600}\n\n\u{1F4A9} **bold \u{1F60D}**\n";
    const result = Markdown.html(input);
    expect(result).toContain("\u{1F600}");
    expect(result).toContain("\u{1F4A9}");
  });

  test("CJK characters", () => {
    const input = "# \u4F60\u597D\u4E16\u754C\n\n\u3053\u3093\u306B\u3061\u306F\n";
    expect(Markdown.html(input)).toContain("\u4F60\u597D");
  });

  test("RTL text", () => {
    const input = "# \u0645\u0631\u062D\u0628\u0627\n\n\u0634\u0643\u0631\u0627\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("mixed scripts and combining characters", () => {
    const input =
      "# Caf\u00E9 na\u00EFve r\u00E9sum\u00E9\n\nZ\u0361\u035C\u0321a\u030A\u0326l\u0338\u031Bg\u030D\u0320o\u0362\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  // ---- Entity edge cases ----

  test("all HTML5 named entities", () => {
    const input = "&amp; &lt; &gt; &quot; &apos; &nbsp; &copy; &reg; &trade;\n";
    const result = Markdown.html(input);
    expect(result).toContain("&amp;");
    expect(result).toContain("&lt;");
  });

  test("numeric entities", () => {
    const input = "&#65; &#x41; &#128512;\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  test("invalid entities pass through", () => {
    const input = "&notavalidentity; &#99999999;\n";
    expect(typeof Markdown.html(input)).toBe("string");
  });

  // ---- Rapid API alternation ----

  test("alternating between html/render/react does not corrupt state", () => {
    const input = "# Hello **world**\n\n- item 1\n- item 2\n";
    for (let i = 0; i < 50; i++) {
      const html = Markdown.html(input);
      expect(html).toContain("<h1>");
      expect(html).toContain("<strong>");

      const rendered = Markdown.render(input, {
        heading: (c: string) => `[H:${c}]`,
        strong: (c: string) => `[B:${c}]`,
      });
      expect(rendered).toContain("[H:");
      expect(rendered).toContain("[B:world]");

      const el = Markdown.react(input, { reactVersion: 18 });
      const reactHtml = renderToString(el);
      expect(reactHtml).toContain("<h1>");
    }
  });

  // ---- GFM extension edge cases ----

  test("wiki links with special characters", () => {
    const input = "[[page with spaces]] [[page/with/slashes]] [[page#with#hashes]]\n";
    const result = Markdown.html(input, { wikiLinks: true });
    expect(typeof result).toBe("string");
  });

  test("latex math edge cases", () => {
    const inputs = [
      "$$ $$\n", // empty display math
      "$ $\n", // empty inline math
      "$a$b$c$\n", // adjacent math
      "$$\n\\frac{1}{2}\n$$\n", // multi-line display math
    ];
    for (const input of inputs) {
      expect(typeof Markdown.html(input, { latexMath: true })).toBe("string");
    }
  });

  test("strikethrough edge cases", () => {
    const inputs = [
      "~~~~\n", // 4 tildes
      "~~ ~~\n", // space-only content
      "~~a~~ ~~b~~\n", // adjacent
      "~~**bold strike**~~\n", // nested
    ];
    for (const input of inputs) {
      expect(typeof Markdown.html(input)).toBe("string");
    }
  });

  test("task list edge cases", () => {
    const inputs = [
      "- [x]\n", // checked, no text
      "- [ ]\n", // unchecked, no text
      "- [X] capital\n", // capital X
      "- [x] **bold task**\n", // nested inline
    ];
    for (const input of inputs) {
      expect(typeof Markdown.html(input)).toBe("string");
    }
  });

  // ---- Autolink edge cases ----

  test("autolink edge cases", () => {
    const inputs = [
      "www.example.com\n",
      "www.example.com/path?q=1&r=2#hash\n",
      "user@example.com\n",
      "https://example.com\n",
      "https://example.com/path(with)parens\n",
    ];
    for (const input of inputs) {
      const result = Markdown.html(input, { permissiveAutolinks: true });
      expect(typeof result).toBe("string");
    }
  });

  // ---- Heading ID collision ----

  test("duplicate heading IDs get deduplicated", () => {
    const input = "# Hello\n\n# Hello\n\n# Hello\n";
    const result = Markdown.html(input, { headingIds: true });
    expect(result).toContain('id="hello"');
    expect(result).toContain('id="hello-1"');
    expect(result).toContain('id="hello-2"');
  });

  test("heading ID deduplication with render()", () => {
    const ids: string[] = [];
    Markdown.render("# A\n\n# A\n\n# A\n", {
      heading: (_c: string, m: any) => {
        ids.push(m.id);
        return "";
      },
      headingIds: true,
    });
    expect(ids).toEqual(["a", "a-1", "a-2"]);
  });
});

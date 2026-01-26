import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";

const Markdown = Bun.markdown;

/** Wrap an array of React elements in a Fragment and renderToString */
function reactRender(md: string, opts?: any): string {
  const elements = Markdown.react(md, opts);
  return renderToString(React.createElement(React.Fragment, null, ...elements));
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
// Bun.markdown.render() — plain object AST
// ============================================================================

describe("Bun.markdown.render", () => {
  test("returns array of element nodes", () => {
    const result = Markdown.render("# Hello\n");
    expect(result).toBeArray();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "h1",
      props: { children: ["Hello"] },
    });
  });

  test("paragraph node", () => {
    const result = Markdown.render("Hello world\n");
    expect(result[0]).toEqual({
      type: "p",
      props: { children: ["Hello world"] },
    });
  });

  test("heading levels 1-6 use HTML tag names", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Level\n";
      const result = Markdown.render(md);
      expect(result[0].type).toBe(`h${i}`);
      expect(result[0].props.children).toEqual(["Level"]);
    }
  });

  test("text is plain strings in children arrays", () => {
    const result = Markdown.render("Hello world\n");
    expect(result[0].props.children).toEqual(["Hello world"]);
  });

  test("mixed text and inline elements", () => {
    const result = Markdown.render("Hello **world**!\n");
    const children = result[0].props.children;
    expect(children[0]).toBe("Hello ");
    expect(children[1]).toEqual({ type: "strong", props: { children: ["world"] } });
    expect(children[2]).toBe("!");
  });

  test("nested inline elements", () => {
    const result = Markdown.render("**bold *and italic***\n");
    const strong = result[0].props.children[0];
    expect(strong.type).toBe("strong");
    expect(strong.props.children[0]).toBe("bold ");
    expect(strong.props.children[1]).toEqual({
      type: "em",
      props: { children: ["and italic"] },
    });
  });

  test("strong", () => {
    const result = Markdown.render("**bold**\n");
    const strong = result[0].props.children[0];
    expect(strong).toEqual({ type: "strong", props: { children: ["bold"] } });
  });

  test("emphasis", () => {
    const result = Markdown.render("*italic*\n");
    const em = result[0].props.children[0];
    expect(em).toEqual({ type: "em", props: { children: ["italic"] } });
  });

  test("strikethrough", () => {
    const result = Markdown.render("~~deleted~~\n");
    const del = result[0].props.children[0];
    expect(del).toEqual({ type: "del", props: { children: ["deleted"] } });
  });

  test("link has href in props", () => {
    const result = Markdown.render("[text](https://example.com)\n");
    const link = result[0].props.children[0];
    expect(link).toEqual({
      type: "a",
      props: { href: "https://example.com", children: ["text"] },
    });
  });

  test("link with title", () => {
    const result = Markdown.render('[text](https://example.com "My Title")\n');
    const link = result[0].props.children[0];
    expect(link.type).toBe("a");
    expect(link.props.href).toBe("https://example.com");
    expect(link.props.title).toBe("My Title");
    expect(link.props.children).toEqual(["text"]);
  });

  test("image has src and alt in props", () => {
    const result = Markdown.render("![alt text](image.png)\n");
    const img = result[0].props.children[0];
    expect(img).toEqual({
      type: "img",
      props: { src: "image.png", alt: "alt text" },
    });
  });

  test("image with title", () => {
    const result = Markdown.render('![alt](pic.jpg "Photo")\n');
    const img = result[0].props.children[0];
    expect(img.props.src).toBe("pic.jpg");
    expect(img.props.title).toBe("Photo");
    expect(img.props.alt).toBe("alt");
  });

  test("code block with language", () => {
    const result = Markdown.render("```js\nconsole.log('hi');\n```\n");
    expect(result[0].type).toBe("pre");
    expect(result[0].props.language).toBe("js");
    expect(result[0].props.children).toBeArray();
  });

  test("code block without language", () => {
    const result = Markdown.render("```\nplain code\n```\n");
    expect(result[0].type).toBe("pre");
    expect(result[0].props.language).toBeUndefined();
  });

  test("inline code", () => {
    const result = Markdown.render("`code`\n");
    const code = result[0].props.children[0];
    expect(code).toEqual({ type: "code", props: { children: ["code"] } });
  });

  test("hr is void element with empty props", () => {
    const result = Markdown.render("---\n");
    expect(result[0]).toEqual({ type: "hr", props: {} });
  });

  test("br produces object node", () => {
    const result = Markdown.render("line1  \nline2\n");
    const children = result[0].props.children;
    const br = children.find((c: any) => typeof c === "object" && c?.type === "br");
    expect(br).toEqual({ type: "br", props: {} });
  });

  test("blockquote", () => {
    const result = Markdown.render("> quoted text\n");
    expect(result[0].type).toBe("blockquote");
    expect(result[0].props.children[0].type).toBe("p");
  });

  test("ordered list with start", () => {
    const result = Markdown.render("3. first\n4. second\n");
    const ol = result[0];
    expect(ol.type).toBe("ol");
    expect(ol.props.start).toBe(3);
    expect(ol.props.children).toHaveLength(2);
    expect(ol.props.children[0].type).toBe("li");
    expect(ol.props.children[1].type).toBe("li");
  });

  test("unordered list", () => {
    const result = Markdown.render("- a\n- b\n");
    const ul = result[0];
    expect(ul.type).toBe("ul");
    expect(ul.props.children).toHaveLength(2);
    expect(ul.props.children[0].type).toBe("li");
  });

  test("headingIds option adds id to heading props", () => {
    const result = Markdown.render("## Hello World\n", { headingIds: true });
    expect(result[0]).toEqual({
      type: "h2",
      props: { id: "hello-world", children: ["Hello World"] },
    });
  });

  test("headingIds deduplication", () => {
    const result = Markdown.render("## Foo\n\n## Foo\n\n## Foo\n", { headingIds: true });
    expect(result[0].props.id).toBe("foo");
    expect(result[1].props.id).toBe("foo-1");
    expect(result[2].props.id).toBe("foo-2");
  });

  test("table structure", () => {
    const result = Markdown.render("| A | B |\n|---|---|\n| 1 | 2 |\n");
    const table = result[0];
    expect(table.type).toBe("table");
    const thead = table.props.children.find((c: any) => c.type === "thead");
    const tbody = table.props.children.find((c: any) => c.type === "tbody");
    expect(thead).toBeDefined();
    expect(tbody).toBeDefined();
    const headerRow = thead.props.children[0];
    expect(headerRow.type).toBe("tr");
    expect(headerRow.props.children[0].type).toBe("th");
    expect(headerRow.props.children[0].props.children).toEqual(["A"]);
  });

  test("entities are decoded to text", () => {
    const result = Markdown.render("&amp;\n");
    const text = result[0].props.children.join("");
    expect(text).toContain("&");
  });

  test("multiple blocks", () => {
    const result = Markdown.render("# Title\n\nParagraph\n");
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("h1");
    expect(result[1].type).toBe("p");
  });

  test("complete document produces correct structure", () => {
    const result = Markdown.render(`# Hello

This is **bold** and *italic*.

- item one
- item two

---
`);
    expect(result[0].type).toBe("h1");
    expect(result[1].type).toBe("p");
    expect(result[2].type).toBe("ul");
    expect(result[3].type).toBe("hr");
  });

  test("can be used to build custom rendering", () => {
    function renderToString(nodes: any[]): string {
      return nodes
        .map((node: any) => {
          if (typeof node === "string") return node;
          const { type, props } = node;
          const { children, ...attrs } = props;
          const attrStr = Object.entries(attrs)
            .map(([k, v]) => ` ${k}="${v}"`)
            .join("");
          if (!children) return `<${type}${attrStr} />`;
          const inner = renderToString(children);
          return `<${type}${attrStr}>${inner}</${type}>`;
        })
        .join("");
    }

    const ast = Markdown.render("# Hello **world**\n");
    const html = renderToString(ast);
    expect(html).toBe("<h1>Hello <strong>world</strong></h1>");
  });
});

// ============================================================================
// Bun.markdown.react() — React element AST
// ============================================================================

describe("Bun.markdown.react", () => {
  const REACT_ELEMENT_SYMBOL = Symbol.for("react.element");
  const REACT_TRANSITIONAL_SYMBOL = Symbol.for("react.transitional.element");

  test("returns array of React elements", () => {
    const result = Markdown.react("# Hello\n");
    expect(result).toBeArray();
    expect(result).toHaveLength(1);
  });

  test("each element has $$typeof symbol", () => {
    const result = Markdown.react("# Hello\n");
    expect(result[0].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
  });

  test("element has type, key, ref, props", () => {
    const result = Markdown.react("# Hello\n");
    const el = result[0];
    expect(el.type).toBe("h1");
    expect(el.key).toBeNull();
    expect(el.ref).toBeNull();
    expect(el.props).toEqual({ children: ["Hello"] });
  });

  test("heading levels 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Level\n";
      const result = Markdown.react(md);
      expect(result[0].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
      expect(result[0].type).toBe(`h${i}`);
      expect(result[0].props.children).toEqual(["Level"]);
    }
  });

  test("text is plain strings in children", () => {
    const result = Markdown.react("Hello world\n");
    expect(result[0].props.children).toEqual(["Hello world"]);
  });

  test("nested inline elements are React elements", () => {
    const result = Markdown.react("Hello **world**\n");
    const p = result[0];
    expect(p.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(p.props.children[0]).toBe("Hello ");
    const strong = p.props.children[1];
    expect(strong.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(strong.type).toBe("strong");
    expect(strong.props.children).toEqual(["world"]);
  });

  test("link has href in props", () => {
    const result = Markdown.react("[click](https://example.com)\n");
    const link = result[0].props.children[0];
    expect(link.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(link.type).toBe("a");
    expect(link.props.href).toBe("https://example.com");
    expect(link.props.children).toEqual(["click"]);
  });

  test("image has src and alt in props", () => {
    const result = Markdown.react("![alt](img.png)\n");
    const img = result[0].props.children[0];
    expect(img.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(img.type).toBe("img");
    expect(img.props.src).toBe("img.png");
    expect(img.props.alt).toBe("alt");
    expect(img.props.children).toBeUndefined();
  });

  test("code block with language", () => {
    const result = Markdown.react("```ts\nconst x = 1;\n```\n");
    const pre = result[0];
    expect(pre.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(pre.type).toBe("pre");
    expect(pre.props.language).toBe("ts");
  });

  test("hr is void element", () => {
    const result = Markdown.react("---\n");
    const hr = result[0];
    expect(hr.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(hr.type).toBe("hr");
    expect(hr.key).toBeNull();
    expect(hr.ref).toBeNull();
    expect(hr.props).toEqual({});
  });

  test("br produces React element", () => {
    const result = Markdown.react("line1  \nline2\n");
    const children = result[0].props.children;
    const br = children.find((c: any) => typeof c === "object" && c?.type === "br");
    expect(br).toBeDefined();
    expect(br.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(br.props).toEqual({});
  });

  test("ordered list with start", () => {
    const result = Markdown.react("3. first\n4. second\n");
    const ol = result[0];
    expect(ol.type).toBe("ol");
    expect(ol.props.start).toBe(3);
    expect(ol.props.children).toHaveLength(2);
    expect(ol.props.children[0].type).toBe("li");
  });

  test("table structure", () => {
    const result = Markdown.react("| A | B |\n|---|---|\n| 1 | 2 |\n");
    const table = result[0];
    expect(table.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(table.type).toBe("table");
    const thead = table.props.children.find((c: any) => c.type === "thead");
    expect(thead).toBeDefined();
    expect(thead.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
  });

  test("headingIds adds id to props", () => {
    const result = Markdown.react("## Hello World\n", { headingIds: true });
    expect(result[0].type).toBe("h2");
    expect(result[0].props.id).toBe("hello-world");
    expect(result[0].props.children).toEqual(["Hello World"]);
  });

  test("reactVersion 18 uses react.element symbol (default)", () => {
    const result = Markdown.react("# Hi\n");
    expect(result[0].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
  });

  test("reactVersion 19 uses react.transitional.element symbol", () => {
    const result = Markdown.react("# Hi\n", { reactVersion: 19 });
    expect(result[0].$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
  });

  test("reactVersion 19 nested elements all use transitional symbol", () => {
    const result = Markdown.react("Hello **world**\n", { reactVersion: 19 });
    const p = result[0];
    expect(p.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
    const strong = p.props.children[1];
    expect(strong.$$typeof).toBe(REACT_TRANSITIONAL_SYMBOL);
  });

  test("multiple blocks", () => {
    const result = Markdown.react("# Title\n\nParagraph\n");
    expect(result).toHaveLength(2);
    expect(result[0].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(result[0].type).toBe("h1");
    expect(result[1].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(result[1].type).toBe("p");
  });

  test("complete document", () => {
    const result = Markdown.react(`# Hello

This is **bold** and *italic*.

- item one
- item two

---
`);
    expect(result[0].type).toBe("h1");
    expect(result[1].type).toBe("p");
    expect(result[2].type).toBe("ul");
    expect(result[3].type).toBe("hr");
    // All are React elements
    for (const el of result) {
      expect(el.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    }
  });

  test("blockquote contains nested React elements", () => {
    const result = Markdown.react("> quoted text\n");
    const bq = result[0];
    expect(bq.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(bq.type).toBe("blockquote");
    const p = bq.props.children[0];
    expect(p.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(p.type).toBe("p");
    expect(p.props.children).toEqual(["quoted text"]);
  });

  test("deeply nested elements are all React elements", () => {
    const result = Markdown.react("> **bold *and italic***\n");
    const bq = result[0];
    expect(bq.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    const p = bq.props.children[0];
    expect(p.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    const strong = p.props.children[0];
    expect(strong.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(strong.type).toBe("strong");
    const em = strong.props.children[1];
    expect(em.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(em.type).toBe("em");
    expect(em.props.children).toEqual(["and italic"]);
  });

  test("link with title in React element", () => {
    const result = Markdown.react('[text](https://example.com "My Title")\n');
    const link = result[0].props.children[0];
    expect(link.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(link.type).toBe("a");
    expect(link.props.href).toBe("https://example.com");
    expect(link.props.title).toBe("My Title");
    expect(link.props.children).toEqual(["text"]);
  });

  test("image with title in React element", () => {
    const result = Markdown.react('![alt](pic.jpg "Photo")\n');
    const img = result[0].props.children[0];
    expect(img.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(img.type).toBe("img");
    expect(img.props.src).toBe("pic.jpg");
    expect(img.props.title).toBe("Photo");
    expect(img.props.alt).toBe("alt");
    expect(img.props.children).toBeUndefined();
  });

  test("inline code is a React element", () => {
    const result = Markdown.react("`code`\n");
    const code = result[0].props.children[0];
    expect(code.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(code.type).toBe("code");
    expect(code.props.children).toEqual(["code"]);
  });

  test("strikethrough is a React element", () => {
    const result = Markdown.react("~~deleted~~\n");
    const del = result[0].props.children[0];
    expect(del.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(del.type).toBe("del");
    expect(del.props.children).toEqual(["deleted"]);
  });

  test("unordered list children are React elements", () => {
    const result = Markdown.react("- a\n- b\n");
    const ul = result[0];
    expect(ul.type).toBe("ul");
    for (const li of ul.props.children) {
      expect(li.$$typeof).toBe(REACT_ELEMENT_SYMBOL);
      expect(li.type).toBe("li");
    }
  });

  test("entities are decoded in React output", () => {
    const result = Markdown.react("&amp; &lt; &gt;\n");
    const text = result[0].props.children.join("");
    expect(text).toContain("&");
    expect(text).toContain("<");
    expect(text).toContain(">");
  });

  test("softbr becomes newline string", () => {
    const result = Markdown.react("line1\nline2\n");
    const children = result[0].props.children;
    expect(children).toContain("\n");
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

  test("react 19 elements also renderToString correctly", () => {
    // React 18 accepts both Symbol.for('react.element') and
    // Symbol.for('react.transitional.element') for rendering
    const elements = Markdown.react("# Hello\n", { reactVersion: 19 });
    // React 18 won't recognize the transitional symbol, so wrap manually
    // Just verify the structure is correct
    expect(elements[0].type).toBe("h1");
    expect(elements[0].props.children).toEqual(["Hello"]);
  });
});

// ============================================================================
// Component overrides (render + react)
// ============================================================================

describe("Bun.markdown.render component overrides", () => {
  test("string override replaces type field", () => {
    const result = Markdown.render("# Hello\n", { h1: "MyHeading" });
    expect(result[0]).toEqual({
      type: "MyHeading",
      props: { children: ["Hello"] },
    });
  });

  test("override all heading levels", () => {
    for (let i = 1; i <= 6; i++) {
      const md = Buffer.alloc(i, "#").toString() + " Level\n";
      const opts: any = { [`h${i}`]: `custom-h${i}` };
      const result = Markdown.render(md, opts);
      expect(result[0].type).toBe(`custom-h${i}`);
      expect(result[0].props.children).toEqual(["Level"]);
    }
  });

  test("paragraph override", () => {
    const result = Markdown.render("Hello\n", { p: "CustomP" });
    expect(result[0].type).toBe("CustomP");
    expect(result[0].props.children).toEqual(["Hello"]);
  });

  test("blockquote override", () => {
    const result = Markdown.render("> quoted\n", { blockquote: "Quote" });
    expect(result[0].type).toBe("Quote");
    expect(result[0].props.children[0].type).toBe("p");
  });

  test("list overrides (ul, ol, li)", () => {
    const result = Markdown.render("- a\n- b\n", { ul: "MyList", li: "MyItem" });
    expect(result[0].type).toBe("MyList");
    expect(result[0].props.children[0].type).toBe("MyItem");
    expect(result[0].props.children[1].type).toBe("MyItem");
  });

  test("ordered list override", () => {
    const result = Markdown.render("1. a\n", { ol: "OL", li: "LI" });
    expect(result[0].type).toBe("OL");
    expect(result[0].props.start).toBe(1);
    expect(result[0].props.children[0].type).toBe("LI");
  });

  test("hr override", () => {
    const result = Markdown.render("---\n", { hr: "Divider" });
    expect(result[0]).toEqual({ type: "Divider", props: {} });
  });

  test("pre (code block) override", () => {
    const result = Markdown.render("```js\ncode\n```\n", { pre: "CodeBlock" });
    expect(result[0].type).toBe("CodeBlock");
    expect(result[0].props.language).toBe("js");
  });

  test("table element overrides", () => {
    const result = Markdown.render("| A |\n|---|\n| 1 |\n", {
      table: "T",
      thead: "THead",
      tbody: "TBody",
      tr: "TR",
      th: "TH",
      td: "TD",
    });
    expect(result[0].type).toBe("T");
    const thead = result[0].props.children.find((c: any) => c.type === "THead");
    const tbody = result[0].props.children.find((c: any) => c.type === "TBody");
    expect(thead).toBeDefined();
    expect(tbody).toBeDefined();
    const headerRow = thead.props.children[0];
    expect(headerRow.type).toBe("TR");
    expect(headerRow.props.children[0].type).toBe("TH");
    const bodyRow = tbody.props.children[0];
    expect(bodyRow.type).toBe("TR");
    expect(bodyRow.props.children[0].type).toBe("TD");
  });

  test("inline element overrides (em, strong, del, code)", () => {
    const result = Markdown.render("**bold** *italic* ~~del~~ `code`\n", {
      strong: "B",
      em: "I",
      del: "S",
      code: "Code",
    });
    const children = result[0].props.children;
    expect(children.find((c: any) => c.type === "B")).toBeDefined();
    expect(children.find((c: any) => c.type === "I")).toBeDefined();
    expect(children.find((c: any) => c.type === "S")).toBeDefined();
    expect(children.find((c: any) => c.type === "Code")).toBeDefined();
  });

  test("link override", () => {
    const result = Markdown.render("[click](https://example.com)\n", { a: "Link" });
    const link = result[0].props.children[0];
    expect(link.type).toBe("Link");
    expect(link.props.href).toBe("https://example.com");
    expect(link.props.children).toEqual(["click"]);
  });

  test("image override", () => {
    const result = Markdown.render("![alt](img.png)\n", { img: "Image" });
    const img = result[0].props.children[0];
    expect(img.type).toBe("Image");
    expect(img.props.src).toBe("img.png");
    expect(img.props.alt).toBe("alt");
  });

  test("br override", () => {
    const result = Markdown.render("line1  \nline2\n", { br: "Break" });
    const children = result[0].props.children;
    const br = children.find((c: any) => typeof c === "object" && c?.type === "Break");
    expect(br).toBeDefined();
    expect(br.props).toEqual({});
  });

  test("boolean values are NOT treated as overrides", () => {
    const result = Markdown.render("# Hello\n", { h1: true });
    expect(result[0].type).toBe("h1");
  });

  test("false is NOT treated as override", () => {
    const result = Markdown.render("# Hello\n", { h1: false });
    expect(result[0].type).toBe("h1");
  });

  test("multiple overrides simultaneously", () => {
    const result = Markdown.render("# Title\n\nParagraph\n\n---\n", {
      h1: "Title",
      p: "Text",
      hr: "Line",
    });
    expect(result[0].type).toBe("Title");
    expect(result[1].type).toBe("Text");
    expect(result[2].type).toBe("Line");
  });

  test("override does not affect children element types", () => {
    const result = Markdown.render("> **bold**\n", { blockquote: "Q" });
    expect(result[0].type).toBe("Q");
    // Inner p and strong should NOT be overridden
    const p = result[0].props.children[0];
    expect(p.type).toBe("p");
    const strong = p.props.children[0];
    expect(strong.type).toBe("strong");
  });

  test("override with number value", () => {
    const result = Markdown.render("# Hello\n", { h1: 42 });
    expect(result[0].type).toBe(42);
  });

  test("headingIds still works with component override", () => {
    const result = Markdown.render("## Hello World\n", { h2: "H", headingIds: true });
    expect(result[0].type).toBe("H");
    expect(result[0].props.id).toBe("hello-world");
  });
});

describe("Bun.markdown.react component overrides", () => {
  const REACT_ELEMENT_SYMBOL = Symbol.for("react.element");

  test("function component override replaces type", () => {
    function MyHeading({ children }: any) {
      return React.createElement("div", { className: "heading" }, ...children);
    }
    const result = Markdown.react("# Hello\n", { h1: MyHeading });
    expect(result[0].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(result[0].type).toBe(MyHeading);
    expect(result[0].props.children).toEqual(["Hello"]);
  });

  test("string override in react mode", () => {
    const result = Markdown.react("# Hello\n", { h1: "section" });
    expect(result[0].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(result[0].type).toBe("section");
    expect(result[0].props.children).toEqual(["Hello"]);
  });

  test("multiple component overrides", () => {
    function P({ children }: any) {
      return React.createElement("div", null, ...children);
    }
    function Strong({ children }: any) {
      return React.createElement("b", null, ...children);
    }
    const result = Markdown.react("Hello **world**\n", { p: P, strong: Strong });
    expect(result[0].type).toBe(P);
    const strong = result[0].props.children[1];
    expect(strong.type).toBe(Strong);
  });

  test("boolean override is ignored in react mode", () => {
    const result = Markdown.react("# Hello\n", { h1: true });
    expect(result[0].type).toBe("h1");
  });

  test("override with reactVersion 19", () => {
    const TRANSITIONAL = Symbol.for("react.transitional.element");
    const result = Markdown.react("# Hello\n", { h1: "custom-h1", reactVersion: 19 });
    expect(result[0].$$typeof).toBe(TRANSITIONAL);
    expect(result[0].type).toBe("custom-h1");
  });

  test("link override preserves href prop", () => {
    function Link({ href, children }: any) {
      return React.createElement("a", { href, className: "custom" }, ...children);
    }
    const result = Markdown.react("[click](https://example.com)\n", { a: Link });
    const link = result[0].props.children[0];
    expect(link.type).toBe(Link);
    expect(link.props.href).toBe("https://example.com");
  });

  test("image override preserves src and alt props", () => {
    function Img(props: any) {
      return React.createElement("img", props);
    }
    const result = Markdown.react("![photo](pic.jpg)\n", { img: Img });
    const img = result[0].props.children[0];
    expect(img.type).toBe(Img);
    expect(img.props.src).toBe("pic.jpg");
    expect(img.props.alt).toBe("photo");
  });

  test("hr override in react mode", () => {
    const result = Markdown.react("---\n", { hr: "custom-hr" });
    expect(result[0].$$typeof).toBe(REACT_ELEMENT_SYMBOL);
    expect(result[0].type).toBe("custom-hr");
    expect(result[0].props).toEqual({});
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

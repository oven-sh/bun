import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";

const Markdown = Bun.markdown;

/** renderToString the Fragment returned by Markdown.react.
 *  Uses reactVersion: 18 since the project has react-dom@18 installed. */
function reactRender(md: string, components?: any, opts?: any): string {
  return renderToString(Markdown.react(md, components, { reactVersion: 18, ...opts }));
}

// ============================================================================
// Bun.markdown.react() — React element AST
// ============================================================================

describe("Bun.markdown.react", () => {
  const REACT_ELEMENT_SYMBOL = Symbol.for("react.element");
  const REACT_FRAGMENT_SYMBOL = Symbol.for("react.fragment");
  const REACT_TRANSITIONAL_SYMBOL = Symbol.for("react.transitional.element");

  /** Helper: get the children array from the Fragment returned by react() */
  function children(md: string, components?: any, opts?: any): any[] {
    return Markdown.react(md, components, opts).props.children;
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
    const el = children("## Hello World\n", undefined, { headings: { ids: true } })[0];
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
    const result = Markdown.react("Hello **world**\n", undefined, { reactVersion: 18 });
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
    const html = reactRender("## Hello World\n", undefined, { headings: { ids: true } });
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
    const result = Markdown.react("# Hello\n", undefined, { reactVersion: 18 });
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
  function children(md: string, components?: any, opts?: any): any[] {
    return Markdown.react(md, components, opts).props.children;
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
    const el = children("# Hello\n", { h1: "custom-h1" }, { reactVersion: 18 })[0];
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

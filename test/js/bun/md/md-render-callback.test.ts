import { describe, expect, test } from "bun:test";

const Markdown = Bun.markdown;

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

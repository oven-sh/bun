import { describe, expect, test } from "bun:test";

const Markdown = (Bun as any).Markdown;

describe("Bun.Markdown.render", () => {
  test("heading callback receives children and level", () => {
    const result = Markdown.render("# Hello\n", {
      heading: (children: string, meta: { level: number }) => `[H${meta.level}]${children}[/H${meta.level}]`,
    });
    expect(result).toBe("[H1]Hello[/H1]");
  });

  test("heading levels 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      const md = "#".repeat(i) + " Level " + i + "\n";
      const result = Markdown.render(md, {
        heading: (children: string, meta: { level: number }) => `<h${meta.level}>${children}</h${meta.level}>`,
      });
      expect(result).toBe(`<h${i}>Level ${i}</h${i}>`);
    }
  });

  test("paragraph callback", () => {
    const result = Markdown.render("Hello world\n", {
      paragraph: (children: string) => `<p class="custom">${children}</p>`,
    });
    expect(result).toBe('<p class="custom">Hello world</p>');
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

  test("nested inline elements", () => {
    const result = Markdown.render("Hello **bold *and italic***\n", {
      strong: (children: string) => `<b>${children}</b>`,
      emphasis: (children: string) => `<i>${children}</i>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("Hello <b>bold <i>and italic</i></b>");
  });

  test("link callback with href metadata", () => {
    const result = Markdown.render('[click here](https://example.com "My Title")\n', {
      link: (children: string, meta: { href: string; title?: string }) =>
        `<a href="${meta.href}" title="${meta.title}">${children}</a>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<a href="https://example.com" title="My Title">click here</a>');
  });

  test("link callback without title", () => {
    const result = Markdown.render("[click](https://example.com)\n", {
      link: (children: string, meta: { href: string; title?: string }) => {
        expect(meta.title).toBeUndefined();
        return `<a href="${meta.href}">${children}</a>`;
      },
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<a href="https://example.com">click</a>');
  });

  test("image callback with src metadata", () => {
    const result = Markdown.render('![alt text](image.png "photo")\n', {
      image: (alt: string, meta: { src: string; title?: string }) =>
        `<img src="${meta.src}" alt="${alt}" title="${meta.title}" />`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<img src="image.png" alt="alt text" title="photo" />');
  });

  test("code block callback with language", () => {
    const result = Markdown.render("```js\nconsole.log('hi');\n```\n", {
      code: (children: string, meta: { language?: string }) => `<pre data-lang="${meta?.language}">${children}</pre>`,
    });
    expect(result).toBe("<pre data-lang=\"js\">console.log('hi');\n</pre>");
  });

  test("code block without language", () => {
    const result = Markdown.render("```\nplain code\n```\n", {
      code: (children: string, meta: { language?: string } | undefined) => {
        expect(meta).toBeUndefined();
        return `<pre>${children}</pre>`;
      },
    });
    expect(result).toBe("<pre>plain code\n</pre>");
  });

  test("inline code (codespan) callback", () => {
    const result = Markdown.render("`inline code`\n", {
      codespan: (children: string) => `<code class="hl">${children}</code>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<code class="hl">inline code</code>');
  });

  test("blockquote callback", () => {
    const result = Markdown.render("> quoted text\n", {
      blockquote: (children: string) => `<blockquote class="fancy">${children}</blockquote>`,
      paragraph: (children: string) => `<p>${children}</p>`,
    });
    expect(result).toBe('<blockquote class="fancy"><p>quoted text</p></blockquote>');
  });

  test("ordered list callback with start", () => {
    const result = Markdown.render("3. first\n4. second\n", {
      list: (children: string, meta: { ordered: boolean; start?: number }) => {
        expect(meta.ordered).toBe(true);
        expect(meta.start).toBe(3);
        return `<ol start="${meta.start}">${children}</ol>`;
      },
      listItem: (children: string) => `<li>${children}</li>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe('<ol start="3"><li>first</li><li>second</li></ol>');
  });

  test("unordered list callback", () => {
    const result = Markdown.render("- a\n- b\n", {
      list: (children: string, meta: { ordered: boolean }) => {
        expect(meta.ordered).toBe(false);
        return `<ul>${children}</ul>`;
      },
      listItem: (children: string) => `<li>${children}</li>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  test("hr callback", () => {
    const result = Markdown.render("---\n", {
      hr: () => "<hr />",
    });
    expect(result).toBe("<hr />");
  });

  test("strikethrough callback", () => {
    const result = Markdown.render("~~deleted~~\n", {
      strikethrough: (children: string) => `<s>${children}</s>`,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("<s>deleted</s>");
  });

  test("text callback transforms text content", () => {
    const result = Markdown.render("Hello world\n", {
      text: (content: string) => content.toUpperCase(),
      paragraph: (children: string) => children,
    });
    expect(result).toBe("HELLO WORLD");
  });

  test("no callbacks = passthrough", () => {
    const result = Markdown.render("Hello **world**\n", {});
    expect(result).toBe("Hello world");
  });

  test("no second argument = passthrough", () => {
    const result = Markdown.render("Hello\n");
    expect(result).toBe("Hello");
  });

  test("callback returning null omits element", () => {
    const result = Markdown.render("# Title\n\nKeep this\n", {
      heading: () => null,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("Keep this");
  });

  test("callback returning undefined omits element", () => {
    const result = Markdown.render("**bold** normal\n", {
      strong: () => undefined,
      paragraph: (children: string) => children,
    });
    expect(result).toBe(" normal");
  });

  test("entities are decoded in text", () => {
    const result = Markdown.render("&amp; &lt; &gt;\n", {
      text: (content: string) => content,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("& < >");
  });

  test("numeric entities are decoded", () => {
    const result = Markdown.render("&#65; &#x42;\n", {
      text: (content: string) => content,
      paragraph: (children: string) => children,
    });
    expect(result).toBe("A B");
  });

  test("callback error propagates", () => {
    expect(() => {
      Markdown.render("# Hello\n", {
        heading: () => {
          throw new Error("callback error");
        },
      });
    }).toThrow("callback error");
  });

  test("multiple blocks produce concatenated output", () => {
    const result = Markdown.render("# Title\n\nParagraph\n", {
      heading: (children: string, meta: { level: number }) => `<h${meta.level}>${children}</h${meta.level}>\n`,
      paragraph: (children: string) => `<p>${children}</p>\n`,
    });
    expect(result).toBe("<h1>Title</h1>\n<p>Paragraph</p>\n");
  });

  test("table callbacks", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    const result = Markdown.render(md, {
      table: (children: string) => `<table>${children}</table>`,
      thead: (children: string) => `<thead>${children}</thead>`,
      tbody: (children: string) => `<tbody>${children}</tbody>`,
      tr: (children: string) => `<tr>${children}</tr>`,
      th: (children: string) => `<th>${children}</th>`,
      td: (children: string) => `<td>${children}</td>`,
    });
    expect(result).toBe(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
  });

  test("html block callback", () => {
    const result = Markdown.render("<div>raw html</div>\n", {
      html: (children: string) => `[HTML:${children}]`,
    });
    expect(result).toBe("[HTML:<div>raw html</div>\n]");
  });

  test("works with parser options", () => {
    const result = Markdown.render("~~strike~~\n", {
      strikethrough: false,
      paragraph: (children: string) => children,
    });
    // With strikethrough disabled, ~~ is literal text
    expect(result).toBe("~~strike~~");
  });
});

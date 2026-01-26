import { describe, expect, test } from "bun:test";

const Markdown = Bun.markdown;

describe("Bun.markdown.render", () => {
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

// Custom HTML renderer built entirely from callbacks
const htmlRenderer = {
  heading: (children: string, { level }: { level: number }) => `<h${level}>${children}</h${level}>\n`,
  paragraph: (children: string) => `<p>${children}</p>\n`,
  strong: (children: string) => `<strong>${children}</strong>`,
  emphasis: (children: string) => `<em>${children}</em>`,
  strikethrough: (children: string) => `<del>${children}</del>`,
  link: (children: string, { href, title }: { href: string; title?: string }) =>
    title ? `<a href="${href}" title="${title}">${children}</a>` : `<a href="${href}">${children}</a>`,
  image: (alt: string, { src, title }: { src: string; title?: string }) =>
    title ? `<img src="${src}" alt="${alt}" title="${title}" />` : `<img src="${src}" alt="${alt}" />`,
  code: (content: string, meta?: { language?: string }) =>
    meta?.language
      ? `<pre><code class="language-${meta.language}">${content}</code></pre>\n`
      : `<pre><code>${content}</code></pre>\n`,
  codespan: (content: string) => `<code>${content}</code>`,
  blockquote: (children: string) => `<blockquote>\n${children}</blockquote>\n`,
  list: (children: string, { ordered, start }: { ordered: boolean; start?: number }) =>
    ordered
      ? start !== 1
        ? `<ol start="${start}">\n${children}</ol>\n`
        : `<ol>\n${children}</ol>\n`
      : `<ul>\n${children}</ul>\n`,
  listItem: (children: string) => `<li>${children}</li>\n`,
  hr: () => `<hr />\n`,
  table: (children: string) => `<table>\n${children}</table>\n`,
  thead: (children: string) => `<thead>\n${children}</thead>\n`,
  tbody: (children: string) => `<tbody>\n${children}</tbody>\n`,
  tr: (children: string) => `<tr>\n${children}</tr>\n`,
  th: (children: string) => `<th>${children}</th>\n`,
  td: (children: string) => `<td>${children}</td>\n`,
  html: (content: string) => content,
  text: (content: string) => content,
};

describe("custom HTML renderer", () => {
  test("renders a complete document", () => {
    const input = `# Welcome

This is **bold** and *italic* text with a [link](https://example.com).

## Code Example

\`\`\`js
console.log("hello");
\`\`\`

Use \`inline code\` in paragraphs.

> A blockquote with **emphasis**.

- item one
- item two

---

| Name | Value |
|------|-------|
| a    | 1     |
`;
    const result = Markdown.render(input, htmlRenderer);
    expect(result).toContain("<h1>Welcome</h1>");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
    expect(result).toContain('<a href="https://example.com">link</a>');
    expect(result).toContain('<code class="language-js">');
    expect(result).toContain("<code>inline code</code>");
    expect(result).toContain("<blockquote>");
    expect(result).toContain("<li>item one</li>");
    expect(result).toContain("<hr />");
    expect(result).toContain("<table>");
    expect(result).toContain("<th>Name</th>");
    expect(result).toContain("<td>a</td>");
  });

  test("handles nested formatting", () => {
    const result = Markdown.render("**bold *and italic* text**\n", htmlRenderer);
    expect(result).toBe("<p><strong>bold <em>and italic</em> text</strong></p>\n");
  });

  test("handles images", () => {
    const result = Markdown.render('![logo](logo.png "Site Logo")\n', htmlRenderer);
    expect(result).toBe('<p><img src="logo.png" alt="logo" title="Site Logo" /></p>\n');
  });

  test("handles ordered lists with start", () => {
    const result = Markdown.render("5. five\n6. six\n", htmlRenderer);
    expect(result).toContain('<ol start="5">');
    expect(result).toContain("<li>five</li>");
  });
});

// ANSI terminal renderer
const ANSI = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  strikethrough: "\x1b[9m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

const ansiRenderer = {
  heading: (children: string, { level }: { level: number }) => {
    const colors = [
      ANSI.bold + ANSI.magenta,
      ANSI.bold + ANSI.blue,
      ANSI.bold + ANSI.cyan,
      ANSI.bold,
      ANSI.bold,
      ANSI.bold,
    ];
    const prefix = "#".repeat(level) + " ";
    return `${colors[level - 1]}${prefix}${children}${ANSI.reset}\n\n`;
  },
  paragraph: (children: string) => `${children}\n\n`,
  strong: (children: string) => `${ANSI.bold}${children}${ANSI.reset}`,
  emphasis: (children: string) => `${ANSI.italic}${children}${ANSI.reset}`,
  strikethrough: (children: string) => `${ANSI.strikethrough}${children}${ANSI.reset}`,
  link: (children: string, { href }: { href: string }) =>
    `${ANSI.underline}${ANSI.blue}${children}${ANSI.reset} (${ANSI.dim}${href}${ANSI.reset})`,
  image: (alt: string, { src }: { src: string }) => `[image: ${alt}](${src})`,
  code: (content: string, meta?: { language?: string }) => {
    const lang = meta?.language ? ` (${meta.language})` : "";
    const border = "─".repeat(40);
    return `${ANSI.dim}${border}${lang}${ANSI.reset}\n${content}${ANSI.dim}${border}${ANSI.reset}\n\n`;
  },
  codespan: (content: string) => `${ANSI.dim}\`${content}\`${ANSI.reset}`,
  blockquote: (children: string) =>
    children
      .split("\n")
      .map((line: string) => `${ANSI.dim}│${ANSI.reset} ${line}`)
      .join("\n"),
  list: (children: string) => `${children}\n`,
  listItem: (children: string) => `  • ${children}\n`,
  hr: () => `${ANSI.dim}${"─".repeat(40)}${ANSI.reset}\n\n`,
  text: (content: string) => content,
};

describe("custom ANSI renderer", () => {
  test("renders headings with colors", () => {
    const result = Markdown.render("# Title\n", ansiRenderer);
    expect(result).toContain(ANSI.bold);
    expect(result).toContain(ANSI.magenta);
    expect(result).toContain("# Title");
    expect(result).toContain(ANSI.reset);
  });

  test("renders bold and italic with ANSI codes", () => {
    const result = Markdown.render("**bold** and *italic*\n", ansiRenderer);
    expect(result).toContain(`${ANSI.bold}bold${ANSI.reset}`);
    expect(result).toContain(`${ANSI.italic}italic${ANSI.reset}`);
  });

  test("renders links with underline and URL", () => {
    const result = Markdown.render("[click](https://example.com)\n", ansiRenderer);
    expect(result).toContain(ANSI.underline);
    expect(result).toContain(ANSI.blue);
    expect(result).toContain("click");
    expect(result).toContain("https://example.com");
  });

  test("renders code blocks with borders", () => {
    const result = Markdown.render("```js\nlet x = 1;\n```\n", ansiRenderer);
    expect(result).toContain("─".repeat(40));
    expect(result).toContain("(js)");
    expect(result).toContain("let x = 1;");
  });

  test("renders inline code with backticks", () => {
    const result = Markdown.render("Use `foo()` here\n", ansiRenderer);
    expect(result).toContain(`${ANSI.dim}\`foo()\`${ANSI.reset}`);
  });

  test("renders blockquotes with bar prefix", () => {
    const result = Markdown.render("> quoted text\n", ansiRenderer);
    expect(result).toContain(`${ANSI.dim}│${ANSI.reset}`);
    expect(result).toContain("quoted text");
  });

  test("renders unordered lists with bullets", () => {
    const result = Markdown.render("- alpha\n- beta\n", ansiRenderer);
    expect(result).toContain("  • alpha");
    expect(result).toContain("  • beta");
  });

  test("renders horizontal rules", () => {
    const result = Markdown.render("---\n", ansiRenderer);
    expect(result).toContain("─".repeat(40));
  });

  test("renders strikethrough", () => {
    const result = Markdown.render("~~deleted~~\n", ansiRenderer);
    expect(result).toContain(`${ANSI.strikethrough}deleted${ANSI.reset}`);
  });

  test("renders a complete document", () => {
    const input = `# My Document

Hello **world**, this is *important*.

## Links

Check out [Bun](https://bun.sh) for more info.

\`\`\`ts
const x: number = 42;
\`\`\`

- first item
- second item

---

> A wise quote.
`;
    const result = Markdown.render(input, ansiRenderer);
    // Verify structure — headings, text, links, code, lists, hr, blockquotes all present
    expect(result).toContain("# My Document");
    expect(result).toContain(`${ANSI.bold}world${ANSI.reset}`);
    expect(result).toContain(`${ANSI.italic}important${ANSI.reset}`);
    expect(result).toContain("Bun");
    expect(result).toContain("https://bun.sh");
    expect(result).toContain("const x: number = 42;");
    expect(result).toContain("  • first item");
    expect(result).toContain("─".repeat(40));
    expect(result).toContain("A wise quote");
  });
});

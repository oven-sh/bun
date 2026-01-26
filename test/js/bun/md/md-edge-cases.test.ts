import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";

const Markdown = Bun.markdown;

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

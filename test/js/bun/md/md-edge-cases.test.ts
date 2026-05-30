import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
    const el = Markdown.react("", undefined, { reactVersion: 18 });
    expect(renderToString(el)).toBe("");
  });

  test("whitespace-only inputs", () => {
    for (const ws of [" ", "\t", "\n", "\r\n", "   \n\t  \n\n"]) {
      expect(typeof Markdown.html(ws)).toBe("string");
      expect(typeof Markdown.render(ws, {})).toBe("string");
      Markdown.react(ws, undefined, { reactVersion: 18 }); // should not throw
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
    Markdown.react(input, undefined, { reactVersion: 18 });
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

  test("ansi: invalid UTF-8 lead bytes do not crash", () => {
    // Lone continuation bytes and bytes >= 0xF8 are non-ASCII but not valid
    // multi-byte lead bytes; previously hit an assert in the width calculator.
    for (const b of [0x80, 0xbf, 0xf8, 0xff]) {
      expect(typeof Markdown.ansi(Buffer.from([b]))).toBe("string");
    }
    const buf = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) buf[i] = i;
    expect(typeof Markdown.ansi(buf)).toBe("string");
    expect(typeof Markdown.ansi(buf, { columns: 4 })).toBe("string");
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

  test("ansi: pathologically nested lists produce linear output", () => {
    // Every rendered list-item line starts with its indentation, so if the
    // per-line indent grows without bound the output becomes quadratic in
    // the nesting depth (a ~240 KB fuzzer document of `- - - …` lines
    // produced gigabytes of ANSI output). The renderer caps the emitted
    // indent, keeping the output proportional to the number of items.
    const depth = 2000;
    const input = Buffer.alloc(depth * 2, "- ").toString() + "hi";
    const out = Markdown.ansi(input);
    expect(out).toContain("hi");
    expect(out).toContain("•");
    // ~8 MB without the indent cap, ~300 KB with it.
    expect(out.length).toBeLessThan(2_000_000);
  });

  test("ansi: pathologically nested blockquotes + lists produce linear output", () => {
    // Same idea as above, but the per-line prefix is dominated by the
    // blockquote `│ ` bars instead of list indent spaces.
    const depth = 1500;
    const input = Buffer.alloc(depth * 2, "> ").toString() + Buffer.alloc(depth * 2, "- ").toString() + "hi";
    const out = Markdown.ansi(input);
    expect(out).toContain("hi");
    expect(out).toContain("│");
    // ~9 MB without the indent cap, ~450 KB with it.
    expect(out.length).toBeLessThan(2_000_000);
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
    const result = Markdown.html(input, { headings: { ids: true } });
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
    autolinks: true,
    hardSoftBreaks: true,
    wikiLinks: true,
    underline: true,
    latexMath: true,
    collapseWhitespace: true,
    permissiveAtxHeaders: true,
    noIndentedCodeBlocks: true,
    noHtmlBlocks: true,
    noHtmlSpans: true,
    headings: true,
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
    const result = Markdown.render(
      input,
      {
        heading: (c: string, m: any) => `[H${m.level}:${c}]`,
        strong: (c: string) => `[B:${c}]`,
      },
      allOptions,
    );
    expect(result).toContain("[H1:");
    expect(result).toContain("[B:world]");
  });

  test("all options work with react()", () => {
    const input = "# Hello **world**\n";
    const el = Markdown.react(input, undefined, { ...allOptions, reactVersion: 18 });
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
        Markdown.react(
          "# Hello\n",
          {
            h1: () => {
              throw new Error("component error");
            },
          },
          { reactVersion: 18 },
        ),
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

      const el = Markdown.react(input, undefined, { reactVersion: 18 });
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
      const result = Markdown.html(input, { autolinks: true });
      expect(typeof result).toBe("string");
    }
  });

  // ---- Heading ID collision ----

  test("duplicate heading IDs get deduplicated", () => {
    const input = "# Hello\n\n# Hello\n\n# Hello\n";
    const result = Markdown.html(input, { headings: { ids: true } });
    expect(result).toContain('id="hello"');
    expect(result).toContain('id="hello-1"');
    expect(result).toContain('id="hello-2"');
  });

  test("heading ID deduplication with render()", () => {
    const ids: string[] = [];
    Markdown.render(
      "# A\n\n# A\n\n# A\n",
      {
        heading: (_c: string, m: any) => {
          ids.push(m.id);
          return "";
        },
      },
      { headings: { ids: true } },
    );
    expect(ids).toEqual(["a", "a-1", "a-2"]);
  });
});

// ============================================================================
// Pathological inputs: the CommonMark unclosed/nested bracket family
// (cmark's test/pathological_tests.py). These were O(n²) — a ~100 KB flood of
// "[" took minutes — because every link candidate rescanned the rest of the
// paragraph for its closing "]". Rendering now happens in linear time; the
// child process is killed after 30s so a regression fails fast instead of
// hanging the test runner.
// ============================================================================

describe("pathological bracket inputs", () => {
  async function expectRendersQuickly(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("DONE");
    expect(exitCode).toBe(0);
  }

  test("bracket floods render in linear time (html)", async () => {
    await expectRendersQuickly(`
        const fill = (n, unit) => Buffer.alloc(n * unit.length, unit).toString();
        const cases = [
          ["unclosed brackets", fill(120000, "["), out => out.length > 120000 && out.includes("[[[[[[[[")],
          ["balanced nested brackets", fill(60000, "[") + fill(60000, "]"), out => out.includes("[[[") && out.includes("]]]")],
          ["blockquote bracket flood", fill(8, "> ") + fill(100000, "["), out => out.includes("<blockquote>") && out.includes("[[[")],
          ["paren + bracket flood", fill(75000, "(") + fill(75000, "["), out => out.includes("(((") && out.includes("[[[")],
          ["unclosed inline destination", fill(50000, "[a](b"), out => out.includes("[a](b")],
          ["unclosed angle destination", fill(50000, "[a](<b"), out => out.length > 100000],
          ["unclosed paren title", fill(50000, "[ (]("), out => out.includes("[ (](")],
          ["bracket then backtick flood", "[" + fill(100000, "\`"), out => out.length > 100000],
          ["unclosed backticks inside link label", "[" + fill(150000, "\`") + "[a](u)](v)", out => out.includes("<a href=") && out.length > 150000],
          ["empty label unclosed destination", fill(50000, "[]("), out => out.includes("[](")],
          ["ref def then nested brackets", "[x]: /url\\n\\n" + fill(60000, "[") + fill(60000, "]"), out => out.includes("[[[") && out.includes("]]]")],
        ];
        for (const [name, input, check] of cases) {
          const out = Bun.markdown.html(input);
          if (!check(out)) throw new Error("unexpected output for " + name + ": " + JSON.stringify(out.slice(0, 200)));
          console.log("OK " + name);
        }
        console.log("DONE");
      `);
  }, 90_000);

  test("bracket floods render in linear time (ansi, wiki links enabled)", async () => {
    await expectRendersQuickly(`
        const fill = (n, unit) => Buffer.alloc(n * unit.length, unit).toString();
        {
          const out = Bun.markdown.ansi(fill(100000, "["), { colors: false });
          if (out.length < 100000) throw new Error("unexpected ansi output length " + out.length);
          console.log("OK ansi unclosed brackets");
        }
        {
          const out = Bun.markdown.ansi(fill(30000, "[[a|"), { colors: false });
          if (out.length < 100000) throw new Error("unexpected ansi wiki output length " + out.length);
          console.log("OK ansi wiki-link flood");
        }
        console.log("DONE");
      `);
  }, 90_000);

  test("long link text is still a link", () => {
    const text = Buffer.alloc(10_000, "x").toString();
    const html = Markdown.html(`[${text}](/url)\n`);
    expect(html).toContain('<a href="/url">');
    expect(html).toContain(text);
  });

  test("bracket inside a code span in a link label is not an inner link", () => {
    // The unclosed ``-run is literal; the single backticks form a code span
    // covering [a](u), so the outer construct is a link (code spans bind
    // tighter than links).
    const html = Markdown.html("[``x`[a](u)`](v)\n");
    expect(html).toContain('<a href="v">');
    expect(html).toContain("<code>[a](u)</code>");
  });

  test("link destination parenthesis nesting is capped at 32 (cmark parity)", () => {
    const nest = (n: number) => "[a](" + "(".repeat(n) + "b" + ")".repeat(n) + ")\n";
    expect(Markdown.html(nest(3))).toContain("<a href=");
    expect(Markdown.html(nest(32))).toContain("<a href=");
    // Beyond the cap the candidate is not a link, matching cmark/commonmark.js.
    const over = Markdown.html(nest(40));
    expect(over).not.toContain("<a href=");
    expect(over).toContain("[a](");
    // The 33rd '(' must not be reparsed as a ()-title opener either.
    const overflowIntoTitle = Markdown.html("[a](" + "(".repeat(33) + "))\n");
    expect(overflowIntoTitle).not.toContain("<a href=");
    expect(overflowIntoTitle).toContain("[a](");
  });

  test("angle-bracket destination may not contain an unescaped '<'", () => {
    expect(Markdown.html("[a](<b<c>)\n")).not.toContain("<a href=");
    expect(Markdown.html("[a](<b\\<c>)\n")).toContain('<a href="b%3Cc"');
  });

  test("()-delimited title may not contain an unescaped '('", () => {
    expect(Markdown.html("[a](/url (tit(le))\n")).not.toContain("<a href=");
    expect(Markdown.html("[a](/url (title))\n")).toContain('title="title"');
    expect(Markdown.html('[a](/url "tit(le")\n')).toContain('title="tit(le"');
  });

  test("reference labels longer than 999 characters are not reference links", () => {
    const label999 = Buffer.alloc(999, "y").toString();
    const label1000 = Buffer.alloc(1000, "y").toString();
    expect(Markdown.html(`[${label999}]: /url\n\n[${label999}]\n`)).toContain('<a href="/url">');
    expect(Markdown.html(`[${label1000}]: /url\n\n[${label1000}]\n`)).not.toContain("<a href=");
  });

  test("wiki link bracket nesting is capped", () => {
    const wiki = (depth: number) => "[[t|" + "[".repeat(depth) + "x" + "]".repeat(depth) + "]]\n";
    // Within the cap the whole construct is one wiki link targeting "t".
    expect(Markdown.html(wiki(3), { wikiLinks: true })).toContain('data-target="t"');
    expect(Markdown.html(wiki(30), { wikiLinks: true })).toContain('data-target="t"');
    // Past the cap the outer candidate is rejected.
    expect(Markdown.html(wiki(40), { wikiLinks: true })).not.toContain('data-target="t"');
  });
});

// ============================================================================
// Pathological inputs: unterminated inline HTML openers. Every `<!--` / `<?` /
// `<!DECL` / `<![CDATA[` candidate used to rescan from its own position to the
// end of the paragraph for a terminator that never appears, so a paragraph
// with many such openers was O(n²) (found by fuzzing: a ~260 KB flood of
// bracket runs + `<!--` spun in find_html_tag). The child process is killed
// after 30s so a regression fails fast instead of hanging the test runner.
// ============================================================================

describe("pathological inline HTML inputs", () => {
  async function expectRendersQuickly(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("DONE");
    expect(exitCode).toBe(0);
  }

  test("unterminated inline HTML openers render in linear time", async () => {
    await expectRendersQuickly(`
        const fill = (n, unit) => Buffer.alloc(n * unit.length, unit).toString();
        const cases = [
          ["unterminated comments", fill(100000, "x <!-- y --\\n"), out => out.includes("&lt;!-- y")],
          ["unterminated processing instructions", fill(100000, "x <? y\\n"), out => out.includes("&lt;? y")],
          ["unterminated declarations", fill(100000, "x <!DOCTYPE y\\n"), out => out.includes("&lt;!DOCTYPE y")],
          ["unterminated CDATA sections", fill(100000, "x <![CDATA[ y\\n"), out => out.includes("&lt;![CDATA[ y")],
          ["bracket runs with unterminated comments", fill(20000, "[[[[[[[ foo <!-- this is a --\\n"), out => out.includes("[[[[[[[") && out.includes("&lt;!--")],
          ["inline links between unterminated comments", fill(20000, "[a](b) <!-- x "), out => out.includes('<a href="b">') && out.includes("&lt;!-- x")],
          ["unterminated comments inside link labels", fill(20000, "[<!-- x](u) <!-- y "), out => out.includes('<a href="u">') && out.includes("&lt;!-- y")],
          ["adjacent comment-label links between unterminated comments", fill(15000, "[<!-- a](u)[<!-- b](v) <!-- c "), out => out.includes('<a href="v">') && out.includes("&lt;!-- c")],
          ["images between unterminated comments", fill(20000, "![a](b) <!-- x "), out => out.includes("<img") && out.includes("&lt;!-- x")],
          ["reference links between unterminated comments", "[r]: /u\\n\\n" + fill(20000, "[a][r] <!-- x "), out => out.includes('<a href="/u">') && out.includes("&lt;!-- x")],
          ["one link with a comment-flooded label", "[" + fill(40000, "<!-- x ") + "](u)", out => out.includes('<a href="u">') && out.includes("&lt;!-- x")],
          ["comment-label link before a comment-flooded label", "[<!-- a](u)[" + fill(40000, "<!-- x ") + "](v) <!-- tail", out => out.includes('<a href="v">') && out.includes("&lt;!-- tail")],
          ["nested comment-label links", fill(20000, "[<!-- ") + "x" + fill(20000, "](u)"), out => out.includes('<a href="u">') && out.includes("[&lt;!--")],
        ];
        for (const [name, input, check] of cases) {
          const out = Bun.markdown.html(input);
          if (!check(out)) throw new Error("unexpected output for " + name + ": " + JSON.stringify(out.slice(0, 200)));
          console.log("OK " + name);
        }
        // The fuzzer hit this through the custom-renderer API — exercise it too.
        if (typeof Bun.markdown.render(fill(20000, "[[[[[[[ foo <!-- this is a --\\n"), {}) !== "string") {
          throw new Error("render() did not return a string");
        }
        console.log("DONE");
      `);
  }, 90_000);

  test("unterminated inline HTML openers stay escaped text", () => {
    expect(Markdown.html("a <!-- b\n")).toBe("<p>a &lt;!-- b</p>\n");
    expect(Markdown.html("a <? b\n")).toBe("<p>a &lt;? b</p>\n");
    expect(Markdown.html("a <!D b\n")).toBe("<p>a &lt;!D b</p>\n");
    expect(Markdown.html("a <![CDATA[ b\n")).toBe("<p>a &lt;![CDATA[ b</p>\n");
  });

  test("a terminated HTML span after an unterminated opener of another kind is still recognized", () => {
    // The failed `<?` scan must not suppress the later `<!-- c -->` comment.
    expect(Markdown.html("a <? x y <!-- c --> d\n")).toBe("<p>a &lt;? x y <!-- c --> d</p>\n");
    // And the other way around: a failed `<!--` scan with a later `?>`-less `<?`.
    expect(Markdown.html("a <!-- x y <? c d\n")).toBe("<p>a &lt;!-- x y &lt;? c d</p>\n");
  });

  test("inline comments spanning multiple lines still become raw HTML", () => {
    expect(Markdown.html("before <!-- mid\nstill comment --> after\n")).toBe(
      "<p>before <!-- mid\nstill comment --> after</p>\n",
    );
    expect(Markdown.html("x <!-- y -- z <!--> w\n")).toBe("<p>x <!-- y -- z <!--> w</p>\n");
  });

  test("consecutive same-length paragraphs do not share unterminated-scan state", () => {
    // Both paragraphs merge to 12-byte inline slices; the recycled buffer must
    // not carry the first paragraph's failed `-->` search into the second.
    expect(Markdown.html("a <!-- bcdef\n\na <!-- b -->\n")).toBe("<p>a &lt;!-- bcdef</p>\n<p>a <!-- b --></p>\n");
  });

  test("unterminated comment openers inside link labels keep the surrounding text literal", () => {
    expect(Markdown.html("[t <!-- u](v) <!-- w --> q\n")).toBe("<p>[t <!-- u](v) <!-- w --> q</p>\n");
  });

  test("links and images interleaved with unterminated comment openers render unchanged", () => {
    expect(Markdown.html("[a](b) <!-- x [a](b)\n")).toBe('<p><a href="b">a</a> &lt;!-- x <a href="b">a</a></p>\n');
    expect(Markdown.html("[<!-- x](u) <!-- y\n")).toBe('<p><a href="u">&lt;!-- x</a> &lt;!-- y</p>\n');
    expect(Markdown.html("![<!-- x](u) <!-- y\n")).toBe('<p><img src="u" alt="&lt;!-- x" /> &lt;!-- y</p>\n');
    expect(Markdown.html("[r]: /u\n\n[a][r] <!-- x [a][r]\n")).toBe(
      '<p><a href="/u">a</a> &lt;!-- x <a href="/u">a</a></p>\n',
    );
    expect(Markdown.html("[<!-- x <!-- x <!-- x ](u)\n")).toBe(
      '<p><a href="u">&lt;!-- x &lt;!-- x &lt;!-- x </a></p>\n',
    );
    expect(Markdown.html("[<!-- a](u)[<!-- b](v) <!-- c\n")).toBe(
      '<p><a href="u">&lt;!-- a</a><a href="v">&lt;!-- b</a> &lt;!-- c</p>\n',
    );
    // Nested link candidates: only the innermost is a link (links cannot
    // contain links), and the unterminated openers at every level stay text.
    expect(Markdown.html("[<!-- [<!-- [<!-- x](u)](u)](u)\n")).toBe(
      '<p>[&lt;!-- [&lt;!-- <a href="u">&lt;!-- x</a>](u)](u)</p>\n',
    );
  });
});

// ============================================================================
// Pathological inputs: permissive-autolink trailing-paren trimming. The GFM
// ")"-balancing pass used to recount every "(" and ")" in the URL for each
// trailing ")" it removed, so a URL whose query string is N closing parens
// cost O(N^2) (~4e12 byte compares for N = 2M, minutes of CPU). The child
// process is killed after 30s so a regression fails fast instead of hanging
// the runner.
// ============================================================================

describe("pathological autolink inputs", () => {
  test("autolink with a long run of trailing close-parens renders in linear time", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const parens = Buffer.alloc(2000000, ")").toString();
        const input = "http://a.bc/?x=" + parens + "\\n";
        const html = Bun.markdown.html(input, { autolinks: true });
        if (!html.includes('<a href="http://a.bc/?x=">')) {
          throw new Error("unexpected link target: " + JSON.stringify(html.slice(0, 120)));
        }
        if (!html.includes(")))))))")) throw new Error("trimmed parens missing from output");
        if (html.length <= parens.length) throw new Error("unexpected output length " + html.length);
        console.log("DONE");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("DONE");
    expect(exitCode).toBe(0);

    // The trimming semantics themselves are unchanged: balanced parens stay
    // part of the URL, a trailing unbalanced ")" is trimmed off it.
    expect(Markdown.html("http://a.bc/?x=(1)\n", { autolinks: true })).toContain('<a href="http://a.bc/?x=(1)">');
    const trimmed = Markdown.html("http://a.bc/?x=(1))\n", { autolinks: true });
    expect(trimmed).toContain('<a href="http://a.bc/?x=(1)">');
    expect(trimmed).not.toContain('x=(1))"');
  }, 90_000);
});

// ============================================================================
// ANSI renderer: text taken from the markdown document must not be able to
// smuggle its own terminal control sequences (OSC 52 clipboard writes, title
// changes, CSI device queries, ...) into the output alongside the renderer's
// styling escapes.
// ============================================================================

describe("ansi renderer source-text control bytes", () => {
  test("escape sequences embedded in markdown source are stripped from terminal output", () => {
    // OSC 52 clipboard-write sequence in a paragraph. With colors disabled
    // the renderer emits no escapes of its own, so the output must contain
    // no ESC or BEL byte at all.
    const osc52 = "before \x1b]52;c;Y3VybCBldmlsLnNoIHwgc2g=\x07 after\n";
    const plain = Markdown.ansi(osc52, { colors: false });
    expect(plain).toContain("before");
    expect(plain).toContain("after");
    expect(plain).not.toContain("\x1b");
    expect(plain).not.toContain("\x07");
    // With colors enabled the renderer emits its own SGR escapes, but never
    // an OSC sequence taken from the document (hyperlinks are off by default).
    expect(Markdown.ansi(osc52)).not.toContain("\x1b]");

    // CSI sequences, OSC title changes, and bare C0 controls are dropped too.
    const csi = Markdown.ansi("x \x1b[31mred\x1b[0m \x1b]0;owned\x07 \x07\x08 y\n", { colors: false });
    expect(csi).toContain("red");
    expect(csi).toContain("y");
    expect(csi).not.toContain("\x1b");
    expect(csi).not.toContain("\x07");
    expect(csi).not.toContain("\x08");

    // A numeric character reference that decodes to a raw control byte is
    // sanitized after decoding.
    expect(Markdown.ansi("a &#27;[31m b\n", { colors: false })).not.toContain("\x1b");

    // Ordinary text is unaffected.
    expect(Markdown.ansi("hello world\n", { colors: false })).toContain("hello world");
  });
});

// ============================================================================
// ANSI renderer: link destinations, image src/title, and code-fence info
// strings come straight from the markdown document. Like paragraph text, they
// must not be able to carry their own terminal control bytes (OSC 52
// clipboard writes, title changes, BEL terminators, ...) into the output.
// ============================================================================

describe("ansi renderer link and metadata control bytes", () => {
  test("escape sequences in link destinations, image metadata, and fence info strings are stripped from terminal output", () => {
    const osc52 = "\x1b]52;c;Y3VybCBldmlsLnNoIHwgc2g=\x07";

    // Angle-bracket link destinations accept almost any byte, so the href can
    // carry control sequences. With colors disabled the renderer emits no
    // escapes of its own, so the rendered link (text plus the " (url)"
    // fallback) must contain no ESC or BEL byte at all.
    const linkMd = `[click](<x\x07${osc52}y>)\n`;
    const plain = Markdown.ansi(linkMd, { colors: false });
    expect(plain).toContain("click");
    // Guard: the input really parsed as a link (otherwise it would echo "](<").
    expect(plain).not.toContain("](<");
    expect(plain).not.toContain("\x1b");
    expect(plain).not.toContain("\x07");

    // Default theme (colors on, hyperlinks off): the renderer only emits its
    // own SGR escapes, never an OSC sequence taken from the document.
    const colored = Markdown.ansi(linkMd);
    expect(colored).toContain("click");
    expect(colored).not.toContain("\x07");
    expect(colored).not.toContain("\x1b]");

    // With hyperlinks enabled the href is wrapped in the renderer's own OSC 8
    // sequence; a BEL or nested OSC from the document must not be able to
    // terminate it early.
    const linked = Markdown.ansi(linkMd, { hyperlinks: true });
    expect(linked).toContain("click");
    expect(linked).not.toContain("\x07");
    expect(linked).not.toContain("\x1b]52");

    // Image src goes into the OSC 8 wrapper too, and the title is printed as
    // the caption when there is no alt text.
    const imgMd = `![](<img\x07${osc52}.png> "ti\x1b]0;owned\x07tle")\n`;
    const imgLinked = Markdown.ansi(imgMd, { hyperlinks: true });
    expect(imgLinked).not.toContain("\x07");
    expect(imgLinked).not.toContain("\x1b]52");
    expect(imgLinked).not.toContain("\x1b]0;");
    const imgPlain = Markdown.ansi(imgMd, { colors: false });
    expect(imgPlain).toContain("[img]");
    expect(imgPlain).not.toContain("\x1b");
    expect(imgPlain).not.toContain("\x07");

    // Code-fence info strings are echoed as the language badge above the block.
    const fenceMd = "```js\x1b]0;owned\x07\nconsole.log(1)\n```\n";
    const fencePlain = Markdown.ansi(fenceMd, { colors: false });
    expect(fencePlain).toContain("console.log(1)");
    expect(fencePlain).not.toContain("\x1b");
    expect(fencePlain).not.toContain("\x07");

    // Ordinary links keep their destination in both modes.
    const normal = Markdown.ansi("[site](https://example.com/a)\n", { colors: false });
    expect(normal).toContain("site");
    expect(normal).toContain("https://example.com/a");
    expect(Markdown.ansi("[site](https://example.com/a)\n", { hyperlinks: true })).toContain(
      "\x1b]8;;https://example.com/a",
    );
  });
});

// ============================================================================
// Pathological inputs: emphasis delimiter floods. Each closer used to scan
// backward over every already-consumed delimiter in the paragraph, so
// ("*a " x N) + ("a* " x N) cost Theta(N^2) inner iterations — minutes of CPU
// for a ~1 MB document. Resolution now skips dead delimiters in O(1); the
// child process is killed after 30s so a regression fails fast instead of
// hanging the test runner.
// ============================================================================

describe("pathological emphasis inputs", () => {
  test("emphasis delimiter floods render in linear time", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fill = (n, unit) => Buffer.alloc(n * unit.length, unit).toString();
        const n = 200000;
        const input = fill(n, "*a ") + fill(n, "a* ");
        const html = Bun.markdown.html(input);
        if (!html.includes("<em>")) throw new Error("expected emphasis in output: " + JSON.stringify(html.slice(0, 120)));
        if (html.length < input.length) throw new Error("unexpected output length " + html.length);
        const ansi = Bun.markdown.ansi(fill(50000, "*a ") + fill(50000, "a* "), { colors: false });
        if (typeof ansi !== "string" || ansi.length === 0) throw new Error("unexpected ansi output");
        console.log("DONE");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("DONE");
    expect(exitCode).toBe(0);

    // Ordinary emphasis still resolves the same way.
    expect(Markdown.html("**bold** and *em*\n")).toBe("<p><strong>bold</strong> and <em>em</em></p>\n");
    expect(Markdown.html("*a **b** c*\n")).toBe("<p><em>a <strong>b</strong> c</em></p>\n");
  }, 90_000);
});

// ============================================================================
// Pathological inputs: reference-definition floods. Every `[label]` reference
// used to do a linear scan over the whole ref-definition list (one
// normalized-label allocation plus a byte compare per stored definition), so a
// document with ~100k definitions and ~120k references cost O(refs x defs) —
// minutes of CPU for a ~3 MB document. Lookups now go through the label index;
// the child process is killed after 30s so a regression fails fast instead of
// hanging the test runner.
// ============================================================================

describe("pathological reference definition inputs", () => {
  test("documents with many reference definitions and references render in linear time", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const pad = n => String(n).padStart(6, "0");
        const NDEFS = 100000;
        const NREFS = 120000;
        const lines = [];
        for (let i = 0; i < NDEFS; i++) lines.push("[r" + pad(i) + "]: /x" + i);
        lines.push("");
        for (let i = 0; i < NREFS; i++) {
          // 6-digit labels starting at 500000 are never defined, so every lookup misses.
          lines.push("[r" + pad(500000 + i) + "]");
          lines.push("");
        }
        lines.push("first [r" + pad(0) + "] last [r" + pad(NDEFS - 1) + "] missing [r-none]");
        const html = Bun.markdown.html(lines.join("\\n"));
        if (!html.includes('<a href="/x0">r000000</a>')) throw new Error("first definition did not resolve: " + JSON.stringify(html.slice(-300)));
        if (!html.includes('<a href="/x99999">r099999</a>')) throw new Error("last definition did not resolve");
        if (!html.includes("[r500000]")) throw new Error("undefined reference should stay literal text");
        if (!html.includes("[r-none]")) throw new Error("undefined reference should stay literal text");
        console.log("DONE");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("DONE");
    expect(exitCode).toBe(0);

    // Reference resolution semantics are unchanged for ordinary documents.
    const resolved = Markdown.html("[a]: /url\n\n[a] and [text][a] and [missing]\n");
    expect(resolved).toContain('<a href="/url">a</a>');
    expect(resolved).toContain('<a href="/url">text</a>');
    expect(resolved).toContain("[missing]");
  }, 90_000);
});

// ============================================================================
// Pathological inputs: table delimiter rows declaring huge column counts. The
// column count taken from the delimiter row used to be unbounded, and every
// body row is padded to that count, so a delimiter row declaring N columns
// followed by M bare `|` body rows emitted N*M empty cells — gigabytes of HTML
// from a ~100 KB document. The count is now capped at 128 columns (md4c
// parity); wider delimiter rows are not tables at all, keeping output linear
// in input size.
// ============================================================================

describe("pathological table inputs", () => {
  test("table delimiter rows declaring more than 128 columns are not parsed as tables", () => {
    const cols = 1000;
    const rows = 2000;
    const input = "|" + "h|".repeat(cols) + "\n" + "|" + "-|".repeat(cols) + "\n" + "|\n".repeat(rows);
    const out = Markdown.html(input);
    expect(out).not.toContain("<table>");
    expect(out).toContain("|h|h|");
    // Without the cap this emitted ~cols*rows empty cells (tens of MB of HTML);
    // the non-table rendering stays proportional to the ~26 KB input.
    expect(out.length).toBeLessThan(1_000_000);

    // The cap matches md4c: 128 columns still renders as a table...
    const table = (n: number) =>
      "|" + "h|".repeat(n) + "\n" + "|" + "-|".repeat(n) + "\n" + "|" + "d|".repeat(n) + "\n";
    const ok = Markdown.html(table(128));
    expect(ok).toContain("<table>");
    expect(ok).toContain("<td>");
    // ...and one more column does not.
    expect(Markdown.html(table(129))).not.toContain("<table>");
  }, 30_000);
});

// ============================================================================
// Pathological inputs: unclosed scheme autolink openers. Every `<scheme:`
// candidate used to scan forward looking for the closing `>` and only stopped
// at `>`, whitespace, or end of content, so a paragraph of repeated `<ab:`
// units cost O(n^2) — minutes of CPU for a ~1 MB document. The scan now also
// stops at the next `<`, keeping inline parsing linear; the child process is
// killed after 30s so a regression fails fast instead of hanging the test
// runner.
// ============================================================================

describe("pathological autolink opener inputs", () => {
  test("unclosed scheme autolink openers render in linear time", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fill = (n, unit) => Buffer.alloc(n * unit.length, unit).toString();
        const flood = "x " + fill(300000, "<ab:");
        const html = Bun.markdown.html(flood);
        if (!html.includes("&lt;ab:&lt;ab:")) throw new Error("expected escaped autolink openers: " + JSON.stringify(html.slice(0, 120)));
        if (html.length < flood.length) throw new Error("unexpected output length " + html.length);
        // A real autolink in front of the flood is still recognized.
        const mixed = Bun.markdown.html("see <https://example.com/x> then " + fill(50000, "<ab:"));
        if (!mixed.includes('<a href="https://example.com/x">https://example.com/x</a>')) {
          throw new Error("real autolink did not render: " + JSON.stringify(mixed.slice(0, 200)));
        }
        console.log("DONE");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("DONE");
    expect(exitCode).toBe(0);

    // Ordinary autolinks are unaffected.
    expect(Markdown.html("<https://example.com/a>\n")).toContain(
      '<a href="https://example.com/a">https://example.com/a</a>',
    );
  }, 90_000);
});

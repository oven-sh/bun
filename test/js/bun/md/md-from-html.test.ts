import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import TurndownService from "turndown";
// @ts-ignore untyped
import { gfm } from "turndown-plugin-gfm";

const { fromHTML } = Bun.markdown;

// ---------------------------------------------------------------------------
// Rule-by-rule expectations. These pin the exact output for the default
// options; they follow turndown's rule set with the documented deviations
// (single space after list markers, `~~` strikethrough, header-less tables
// still become pipe tables, bare `<pre>` is a code block).
// ---------------------------------------------------------------------------
describe("Bun.markdown.fromHTML", () => {
  describe("block rules", () => {
    const cases: [string, string, string][] = [
      ["paragraphs", "<p>one</p><p>two</p>", "one\n\ntwo"],
      ["div is a block boundary", "<div>one</div><div>two</div>", "one\n\ntwo"],
      [
        "headings atx",
        "<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>",
        "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f",
      ],
      ["heading with inline markup", "<h2>Hello <em>there</em> <code>x</code></h2>", "## Hello _there_ `x`"],
      ["blockquote", "<blockquote><p>one</p><p>two</p></blockquote>", "> one\n>\n> two"],
      ["nested blockquote", "<blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote>", "> a\n>\n> > b"],
      ["hr", "<p>a</p><hr><p>b</p>", "a\n\n---\n\nb"],
      ["br", "<p>a<br>b</p>", "a  \nb"],
      ["unordered list", "<ul><li>one</li><li>two</li></ul>", "- one\n- two"],
      ["ordered list", "<ol><li>one</li><li>two</li></ol>", "1. one\n2. two"],
      ["ordered list start", '<ol start="7"><li>a</li><li>b</li></ol>', "7. a\n8. b"],
      [
        "nested list",
        "<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>",
        "- a\n  - b\n    - c\n- d",
      ],
      ["nested ordered indent follows marker width", "<ol><li>a<ul><li>b</li></ul></li></ol>", "1. a\n   - b"],
      ["loose list items", "<ul><li><p>a</p></li><li><p>b</p><p>c</p></li></ul>", "- a\n\n- b\n\n  c"],
      ["list after paragraph", "<p>x</p><ul><li>a</li></ul><p>y</p>", "x\n\n- a\n\ny"],
      ["whitespace between li is ignored", "<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>", "- a\n- b"],
      [
        "fenced code block with language",
        '<pre><code class="language-ts">const x: number = 1;\n</code></pre>',
        "```ts\nconst x: number = 1;\n```",
      ],
      [
        "code block keeps markdown characters literally",
        "<pre><code>*a* _b_ [c]\n  # not a heading</code></pre>",
        "```\n*a* _b_ [c]\n  # not a heading\n```",
      ],
      [
        "fence grows past backtick runs in the code",
        "<pre><code>```\ninner\n```</code></pre>",
        "````\n```\ninner\n```\n````",
      ],
      ["bare pre is a code block", "<pre>line 1\n  line 2</pre>", "```\nline 1\n  line 2\n```"],
      [
        "pre with highlighted spans",
        '<div class="highlight highlight-source-js"><pre><span class="k">let</span> x;</pre></div>',
        "```js\nlet x;\n```",
      ],
      ["lang- class prefix", '<pre><code class="hljs lang-rust">fn f() {}</code></pre>', "```rust\nfn f() {}\n```"],
      [
        "pre lang attribute (GitHub API HTML)",
        '<pre lang="toml"><code>[a]\nb = 1</code></pre>',
        "```toml\n[a]\nb = 1\n```",
      ],
      [
        "heading content is one line",
        "<h1><span>Brand</span><div>tag <em>line</em></div><br>x</h1>",
        "# Brand tag _line_ x",
      ],
      ["leading newline after <pre> is dropped by the HTML parser", "<pre>\nx\n</pre>", "```\nx\n```"],
      ["dl/dt/dd are blocks", "<dl><dt>term</dt><dd>def</dd></dl>", "term\n\ndef"],
      ["details/summary are blocks", "<details><summary>More</summary>Hidden text</details>", "More\n\nHidden text"],
      ["empty blocks vanish", "<p></p><div> </div><p>x</p>", "x"],
      ["unknown block-ish custom element is inline", "<x-foo>a</x-foo><x-foo>b</x-foo>", "ab"],
    ];
    for (const [name, html, md] of cases) {
      test(name, () => expect(fromHTML(html)).toBe(md));
    }
  });

  describe("inline rules", () => {
    const cases: [string, string, string][] = [
      ["strong/b", "<p><strong>a</strong> <b>b</b></p>", "**a** **b**"],
      ["em/i", "<p><em>a</em> <i>b</i></p>", "_a_ _b_"],
      ["nested emphasis", "<p><b>a <i>b</i></b></p>", "**a _b_**"],
      ["empty emphasis is dropped", "<p>a<b></b>b<i> </i>c</p>", "ab c"],
      ["emphasis hoists edge whitespace", "<p>a<b> bold </b>b</p>", "a **bold** b"],
      ["hoisted whitespace collapses against neighbours", "<p>a <b> bold </b> b</p>", "a **bold** b"],
      ["inline code", "<p>Use <code>foo()</code> now</p>", "Use `foo()` now"],
      ["inline code containing backticks", "<p><code>a`b</code> <code>``</code></p>", "``a`b`` ` `` `"],
      ["inline code edge backtick gets padding", "<p><code>`x</code></p>", "`` `x ``"],
      ["inline code is not escaped", "<p><code>*a* [b]</code></p>", "`*a* [b]`"],
      ["kbd/samp/var are plain", "<p><kbd>Ctrl</kbd>+<samp>C</samp> <var>n</var></p>", "Ctrl+C n"],
      ["link", '<p><a href="https://bun.com">Bun</a></p>', "[Bun](https://bun.com)"],
      ["link with title", '<p><a href="/x" title="The X">x</a></p>', '[x](/x "The X")'],
      ["link title quotes are escaped", '<p><a href="/x" title=\'say "hi"\'>x</a></p>', '[x](/x "say \\"hi\\"")'],
      ["link destination parens/angles are escaped", '<p><a href="/a_(b)<c>">x</a></p>', "[x](/a_\\(b\\)\\<c\\>)"],
      ["link destination with spaces is bracketed", '<p><a href="/a b">x</a></p>', "[x](</a b>)"],
      ["link destination drops tabs/newlines", '<p><a href="/a\n\tb">x</a></p>', "[x](/ab)"],
      ["anchor without href is plain text", '<p><a name="top">x</a> <a href="">y</a></p>', "x y"],
      [
        "link wrapping an image",
        '<p><a href="/big"><img src="/small.png" alt="pic"></a></p>',
        "[![pic](/small.png)](/big)",
      ],
      ["empty link is kept (href is meaningful)", '<p>a<a href="/x"></a>b</p>', "a[](/x)b"],
      ["image", '<p><img src="a.png" alt="Alt text" title="T"></p>', '![Alt text](a.png "T")'],
      ["image without src is dropped", '<p>a<img alt="x">b</p>', "ab"],
      ["image alt is escaped", '<p><img src="a.png" alt="*x* [y]"></p>', "![\\*x\\* \\[y\\]](a.png)"],
      ["image keeps surrounding spaces", '<p>a <img src="x.png"> b</p>', "a ![](x.png) b"],
      ["strikethrough", "<p><del>a</del> <s>b</s> <strike>c</strike></p>", "~~a~~ ~~b~~ ~~c~~"],
      [
        "sub/sup/span/font pass through",
        '<p>H<sub>2</sub>O x<sup>2</sup> <span class="c">s</span><font>f</font></p>',
        "H2O x2 sf",
      ],
      ["br inside otherwise-empty inline is kept", "<p>a<b><br></b>b</p>", "a  \nb"],
    ];
    for (const [name, html, md] of cases) {
      test(name, () => expect(fromHTML(html)).toBe(md));
    }
  });

  describe("whitespace", () => {
    const cases: [string, string, string][] = [
      ["runs collapse to one space", "<p>a  \n\t b</p>", "a b"],
      ["leading/trailing document whitespace is trimmed", "\n\n  <p> x </p>\n\n", "x"],
      ["space between inline siblings survives", "<p><b>a</b> <i>b</i></p>", "**a** _b_"],
      ["no space is invented between touching inlines", "<p><b>a</b><i>b</i></p>", "**a**_b_"],
      [
        "newline between inline elements becomes a space",
        "<p><a href='/a'>a</a>\n<a href='/b'>b</a></p>",
        "[a](/a) [b](/b)",
      ],
      ["nbsp is preserved, not collapsed", "<p>a&nbsp;&nbsp;b</p>", "a\u00a0\u00a0b"],
      ["nbsp at element edge is hoisted, not dropped", "<p>a<b>&nbsp;x</b></p>", "a\u00a0**x**"],
      ["text directly in body", "hello <b>world</b>", "hello **world**"],
      ["comments are dropped", "<p>a<!-- hidden -->b</p>", "ab"],
      ["at most one blank line between blocks", "<p>a</p>\n\n\n<div><div><p>b</p></div></div>", "a\n\nb"],
    ];
    for (const [name, html, md] of cases) {
      test(name, () => expect(fromHTML(html)).toBe(md));
    }
  });

  describe("escaping", () => {
    const cases: [string, string, string][] = [
      ["emphasis characters", "<p>2 * 3 * 4 and _x_</p>", "2 \\* 3 \\* 4 and \\_x\\_"],
      [
        "intraword underscores are left alone",
        "<p>snake_case_name and __dunder__</p>",
        "snake_case_name and \\_\\_dunder\\_\\_",
      ],
      ["brackets and backslashes", "<p>a[1] b\\c `d`</p>", "a\\[1\\] b\\\\c \\`d\\`"],
      [
        "line-start markers",
        "<p>- a</p><p>+ b</p><p>1. c</p><p># d</p><p>&gt; e</p><p>=f</p><p>~~~g</p>",
        "\\- a\n\n\\+ b\n\n1\\. c\n\n\\# d\n\n\\> e\n\n\\=f\n\n\\~~~g",
      ],
      ["line-start markers mid-line are not escaped", "<p>a - b + c 1. d # e &gt; f</p>", "a - b + c 1. d # e > f"],
      ["line-start marker after a <br> is escaped", "<p>a<br>- b</p>", "a  \n\\- b"],
      ["line-start marker at the start of a list item", "<ul><li>- x</li><li>3. y</li></ul>", "- \\- x\n- 3\\. y"],
      ["hash without following space is literal", "<p>#tag and ## x</p>", "#tag and ## x"],
      [
        "literal tags in text are escaped",
        "<p>a &lt;b&gt; c &lt;/b&gt; &lt;!-- d &amp; 1 &lt; 2</p>",
        "a \\<b> c \\</b> \\<!-- d & 1 < 2",
      ],
      ["entities are decoded", "<p>&copy; &amp;amp; &quot;q&quot; &#x1F600;</p>", '© &amp; "q" 😀'],
    ];
    for (const [name, html, md] of cases) {
      test(name, () => expect(fromHTML(html)).toBe(md));
    }
  });

  // HTML tokenizer behaviour (entities, CR/NUL handling, raw-text elements,
  // comments, doctypes, malformed tags). The expected strings were produced
  // with html5ever's reference tokenizer driving the same tree builder; the
  // built-in tokenizer must match them exactly.
  describe("tokenizer", () => {
    const cases: [string, string, string][] = [
      [
        "named entities with and without semicolon",
        "<p>&amp; &amp &lt;b&gt; &copy &notin; &notit; &noti &xyz; &;</p>",
        "& & \\<b> © ∉ ¬it; ¬i &xyz; &;",
      ],
      [
        "entities in attributes keep &not= literal",
        '<p><a href="/x?a=1&not=2&notin;3&amp;4&copy">l</a></p>',
        "[l](/x?a=1&not=2∉3&4©)",
      ],
      [
        "numeric references",
        "<p>&#65;&#x41;&#x1F600; &#128; &#x80; &#0; &#xD800; &#x110000; &#65 &#x41x &# &#x;</p>",
        "AA😀 € € � � � A Ax &# &#x;",
      ],
      ["CRLF and CR are newlines", "<p>a\r\nb\rc</p><pre>x\r\ny\rz</pre>", "a b c\n\n```\nx\ny\nz\n```"],
      ["CR inside attribute value", '<p><a href="/a\r\nb" title="t\rt">x</a></p>', '[x](/ab "t\nt")'],
      [
        "uppercase tags and attributes",
        '<P><A HREF="/X" TiTlE="T">Link</A> <IMG SRC="i.png" ALT="A"></P>',
        '[Link](/X "T") ![A](i.png)',
      ],
      ["duplicate attributes: first wins", '<p><a href="/first" href="/second">x</a></p>', "[x](/first)"],
      [
        "unquoted and empty attribute values",
        "<p><a href=/x title=hello>a</a> <a href=>b</a> <a href>c</a> <img src=i.png alt></p>",
        '[a](/x "hello") b c ![](i.png)',
      ],
      ["spaces around =", '<p><a href = "/x" >y</a></p>', "[y](/x)"],
      ["self-closing and end tags with junk", "<p>a<br/>b<br / >c</p></p x=1><p>d</p>", "a  \nb  \nc\n\nd"],
      [
        "bogus comments and processing instructions",
        "<p>a<?php echo 1 ?>b<!x>c</ br>d<!-->e<!--->f<!-- g -- h -->i</p>",
        "abcdefi",
      ],
      [
        "title and textarea are RCDATA",
        "<title>a<b>&amp;</title><p><textarea><b>&lt;</b></textarea>x</p>",
        "\\<b><\\</b>x",
      ],
      ["style/xmp are raw text", "<style>p<b>{}</style><p>a<xmp><b>&amp;</xmp>b</p>", "a\n\n\\<b>&amp;b"],
      [
        "script with escaped and double-escaped sections",
        "<script><!-- <script> </script> x </script> --> </script><p>after</p>",
        "\\-->\n\nafter",
      ],
      ["script comment without close", "<script><!-- if (a<b) --> </script><p>ok</p>", "ok"],
      [
        "plaintext swallows everything",
        "<p>a</p><plaintext><b>&amp;</b></plaintext><p>b",
        "a\n\n\\<b>&amp;\\</b>\\</plaintext>\\<p>b",
      ],
      [
        "CDATA only in foreign content",
        "<p><![CDATA[x<y]]>a</p><p><svg><![CDATA[x<y]]></svg>b</p><p><math><mi><![CDATA[z]]></mi></math></p>",
        "a\n\nx\\<yb\n\nz",
      ],
      [
        "doctype decides quirks: table inside p",
        "<!DOCTYPE html><p>a<table><tr><td>b</td><td>c</td></tr></table>",
        "a\n\n| b | c |\n| --- | --- |",
      ],
      [
        "quirks mode keeps table in p",
        "<p>a<table><tr><td>b</td><td>c</td></tr></table>",
        "a\n\n| b | c |\n| --- | --- |",
      ],
      [
        "legacy doctype public id",
        '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd"><p>x</p>',
        "x",
      ],
      ["BOM at start is dropped, elsewhere kept", "﻿<p>a﻿b</p>", "a﻿b"],
      ["EOF inside a tag drops it", '<p>kept</p><a href="/x', "kept"],
      ["EOF inside comment", "<p>a</p><!-- b", "a"],
      ["end tag with attributes still closes", "<p><b>a</b x=1>b</p>", "**a**b"],
      ["NUL bytes", "<p>a\u0000b</p><pre>c\u0000d</pre><p><b x\u0000y=1>e</b></p>", "ab\n\n```\ncd\n```\n\n**e**"],
      ["less-than that does not start a tag", "<p>1 < 2 <3 a<=b </3 <</p>", "1 < 2 <3 a<=b"],
      ["non-ASCII tag and attribute names", '<p><é>x</é> <a hréf="/x" href="/y">z</a></p>', "<é>x [z](/y)"],
      ["form feed and tab as attribute separators", "<p><a\fhref='/x'\ttitle='t'>y</a></p>", '[y](/x "t")'],
    ];

    for (const [name, html, md] of cases) {
      test(name, () => expect(fromHTML(html)).toBe(md));
    }
    test("escape precision: only text that starts a line is escaped", () => {
      expect(fromHTML("<p>a<span>- b</span> <b>1. c</b> <em>#</em> d</p><p><span>- e</span></p>")).toBe(
        "a- b **1. c** _#_ d\n\n\\- e",
      );
    });
  });

  describe("tables", () => {
    test("thead/tbody with alignment", () => {
      expect(
        fromHTML(
          '<table><thead><tr><th>A</th><th align="center">B</th><th style="text-align: right">C</th></tr></thead>' +
            "<tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>",
        ),
      ).toBe("| A | B | C |\n| --- | :-: | --: |\n| 1 | 2 | 3 |");
    });
    test("first row becomes the header when there is no thead/th", () => {
      expect(fromHTML("<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>")).toBe(
        "| a | b |\n| --- | --- |\n| 1 | 2 |",
      );
    });
    test("single-row multi-cell table still converts", () => {
      expect(fromHTML("<table><tr><td>a</td><td>b</td></tr></table>")).toBe("| a | b |\n| --- | --- |");
    });
    test("rows are padded to the widest row and colspan adds cells", () => {
      expect(
        fromHTML(
          '<table><tr><th colspan="2">ab</th><th>c</th></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>x</td></tr></table>',
        ),
      ).toBe("| ab |  | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| x |  |  |");
    });
    test("pipes in cells are escaped and block content is flattened", () => {
      expect(
        fromHTML("<table><tr><th>a|b</th><th>c</th></tr><tr><td><p>one</p><p>two</p></td><td>x<br>y</td></tr></table>"),
      ).toBe("| a\\|b | c |\n| --- | --- |\n| one two | x y |");
    });
    test("list inside a cell", () => {
      expect(
        fromHTML(
          "<table><tr><th>a</th><th>b</th></tr><tr><td><ul><li>x</li><li>y</li></ul></td><td>z</td></tr></table>",
        ),
      ).toBe("| a | b |\n| --- | --- |\n| - x - y | z |");
    });
    test("caption precedes the table", () => {
      expect(fromHTML("<table><caption>Cap <b>bold</b></caption><tr><th>a</th><th>b</th></tr></table>")).toBe(
        "Cap **bold**\n\n| a | b |\n| --- | --- |",
      );
    });
    test("tfoot rows come last, thead rows first", () => {
      expect(
        fromHTML(
          "<table><tfoot><tr><td>f1</td><td>f2</td></tr></tfoot><tbody><tr><td>b1</td><td>b2</td></tr></tbody><thead><tr><th>h1</th><th>h2</th></tr></thead></table>",
        ),
      ).toBe("| h1 | h2 |\n| --- | --- |\n| b1 | b2 |\n| f1 | f2 |");
    });
    test("single-cell table is unwrapped", () => {
      expect(fromHTML("<table><tr><td><p>just layout</p><p>more</p></td></tr></table>")).toBe("just layout\n\nmore");
    });
    test("layout table wrapping another table is unwrapped, inner table converts", () => {
      expect(
        fromHTML(
          "<table><tr><td><h2>Title</h2></td><td><table><tr><th>k</th><th>v</th></tr><tr><td>1</td><td>2</td></tr></table></td></tr></table>",
        ),
      ).toBe("## Title\n\n| k | v |\n| --- | --- |\n| 1 | 2 |");
    });
    test("empty table produces nothing", () => {
      expect(fromHTML("<p>a</p><table></table><table><tr></tr></table><p>b</p>")).toBe("a\n\nb");
    });
    test("tables: false unwraps cells into blocks", () => {
      expect(
        fromHTML("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>", { tables: false }),
      ).toBe("a\n\nb\n\n1\n\n2");
    });
  });

  describe("task lists", () => {
    test("checkbox leading a list item", () => {
      expect(
        fromHTML('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>'),
      ).toBe("- [x] done\n- [ ] todo");
    });
    test("checkbox elsewhere is dropped", () => {
      expect(fromHTML('<p>a<input type="checkbox" checked>b <input type="text" value="v"></p>')).toBe("ab");
    });
    test("tasklists: false drops the checkbox", () => {
      expect(fromHTML('<ul><li><input type="checkbox" checked> done</li></ul>', { tasklists: false })).toBe("- done");
    });
  });

  describe("document handling", () => {
    test("full document: only body content, head is ignored", () => {
      expect(
        fromHTML(
          "<!DOCTYPE html><html><head><title>T</title><style>p{}</style><script>var x</script></head><body><p>Body</p></body></html>",
        ),
      ).toBe("Body");
    });
    test("script/style/noscript/template in body are dropped", () => {
      expect(
        fromHTML(
          "<p>a</p><script>alert('*')</script><style>b{}</style><noscript><p>enable js</p></noscript><template><p>t</p></template><p>b</p>",
        ),
      ).toBe("a\n\nb");
    });
    test("dropped elements do not glue words or double spaces", () => {
      expect(fromHTML("<p>a <script>x</script> b<script>y</script>c</p>")).toBe("a bc");
    });
    test("svg/math text content passes through", () => {
      expect(fromHTML('<p>icon<svg><title>t</title><path d="M0"/></svg> and <math><mi>x</mi></math></p>')).toBe(
        "icont and x",
      );
    });
    test("iframe/video/audio/canvas produce nothing but do not swallow siblings", () => {
      expect(fromHTML('<p>a</p><iframe src="x"></iframe><video src="v"></video><canvas></canvas><p>b</p>')).toBe(
        "a\n\nb",
      );
    });
    test("frameset document", () => {
      expect(fromHTML("<html><frameset><frame src=a></frameset></html>")).toBe("");
    });
    test("empty and whitespace-only input", () => {
      expect(fromHTML("")).toBe("");
      expect(fromHTML(" \n\t")).toBe("");
      expect(fromHTML("<!-- only a comment -->")).toBe("");
    });
  });

  describe("options", () => {
    test("headingStyle: setext", () => {
      expect(fromHTML("<h1>One</h1><h2>Two</h2><h3>Three</h3>", { headingStyle: "setext" })).toBe(
        "One\n===\n\nTwo\n---\n\n### Three",
      );
      // Underline is as wide as the (flattened) text, in characters not bytes.
      expect(fromHTML("<h1>caf\u00e9<br>ok</h1>", { headingStyle: "setext" })).toBe("caf\u00e9 ok\n=======");
    });
    test("hr", () => {
      for (const hr of ["---", "***", "___", "- - -", "* * *", "_ _ _"] as const) {
        expect(fromHTML("<hr>", { hr })).toBe(hr);
      }
    });
    test("bulletListMarker", () => {
      expect(fromHTML("<ul><li>a</li></ul>", { bulletListMarker: "*" })).toBe("* a");
      expect(fromHTML("<ul><li>a</li></ul>", { bulletListMarker: "+" })).toBe("+ a");
    });
    test("codeBlockStyle: indented", () => {
      expect(
        fromHTML('<pre><code class="language-js">a\n  b</code></pre><p>x</p>', { codeBlockStyle: "indented" }),
      ).toBe("    a\n      b\n\nx");
    });
    test("fence: ~~~", () => {
      expect(fromHTML("<pre><code>~~~\nx</code></pre>", { fence: "~~~" })).toBe("~~~~\n~~~\nx\n~~~~");
    });
    test("emDelimiter / strongDelimiter", () => {
      expect(fromHTML("<p><em>a</em> <strong>b</strong></p>", { emDelimiter: "*", strongDelimiter: "__" })).toBe(
        "*a* __b__",
      );
    });
    test("br: backslash", () => {
      expect(fromHTML("<p>a<br>b</p>", { br: "\\" })).toBe("a\\\nb");
    });
    test("strikethrough: false keeps the text", () => {
      expect(fromHTML("<p><del>a</del></p>", { strikethrough: false })).toBe("a");
    });
    test("undefined/null options mean defaults; unknown keys are ignored", () => {
      expect(fromHTML("<h1>a</h1>", undefined)).toBe("# a");
      expect(fromHTML("<h1>a</h1>", null as any)).toBe("# a");
      expect(fromHTML("<h1>a</h1>", { headingStyle: undefined, whatever: 1 } as any)).toBe("# a");
    });
    test("invalid enum values throw", () => {
      expect(() => fromHTML("<h1>a</h1>", { headingStyle: "loud" } as any)).toThrow(/headingStyle/);
      expect(() => fromHTML("<hr>", { hr: "-*-" } as any)).toThrow(/hr/);
      expect(() => fromHTML("<br>", { br: " " } as any)).toThrow(/br/);
      expect(() => fromHTML("<ul><li>a</li></ul>", { bulletListMarker: 1 } as any)).toThrow(/bulletListMarker/);
    });
    test("missing input throws", () => {
      expect(() => (fromHTML as any)()).toThrow();
      expect(() => fromHTML(null as any)).toThrow();
      expect(() => fromHTML(123 as any)).toThrow();
    });
  });

  describe("input types", () => {
    test("Uint8Array / ArrayBuffer / Buffer", () => {
      const bytes = new TextEncoder().encode("<p>caf\u00e9 <b>ok</b></p>");
      expect(fromHTML(bytes)).toBe("caf\u00e9 **ok**");
      expect(fromHTML(bytes.buffer)).toBe("caf\u00e9 **ok**");
      expect(fromHTML(Buffer.from(bytes))).toBe("caf\u00e9 **ok**");
    });
    test("invalid UTF-8 bytes become U+FFFD instead of throwing", () => {
      expect(fromHTML(new Uint8Array([0x3c, 0x70, 0x3e, 0x61, 0xff, 0x62]))).toBe("a\ufffdb");
    });
    test("lone surrogate in a JS string does not throw", () => {
      expect(typeof fromHTML("<p>a\ud800b</p>")).toBe("string");
    });
    test("option getters run before the input buffer is read", () => {
      // A getter that detaches the buffer must not leave the converter
      // reading freed memory: options are evaluated first, then the (now
      // empty) buffer is read.
      const buf = new Uint8Array(new TextEncoder().encode("<p>hello</p>"));
      const opts = {
        get headingStyle() {
          buf.buffer.transfer();
          return "atx";
        },
      };
      expect(fromHTML(buf, opts as any)).toBe("");
    });
    test("NUL bytes", () => {
      expect(fromHTML("<p>a\u0000b</p>")).toBe("ab");
    });
  });

  describe("malformed input never throws", () => {
    const nasties: [string, string][] = [
      ["unclosed tags", "<p>a<b>b<i>c"],
      ["stray end tags", "</div></p></b>text</table>"],
      ["misnested formatting (adoption agency)", "<p><b>a<i>b</b>c</i>d</p>"],
      ["table junk (foster parenting)", "<table>oops<tr>more<td>cell</td>bad</tr></table>"],
      ["p inside button inside a", "<a href=x><button><p>hi</a></button>"],
      ["unterminated comment", "<p>a<!-- forever"],
      ["unterminated tag", "<p>a<b"],
      ["unterminated attribute", '<a href="x'],
      ["bogus doctype and PI", "<!DOCTYPE whatever SYSTEM><?xml version=1?><p>x</p>"],
      ["CDATA outside foreign content", "<p><![CDATA[ x ]]></p>"],
      ["nested forms and selects", "<form><form><select><select><option>x</select>"],
      ["plaintext element swallows the rest", "<plaintext><p>not a tag</p>"],
      ["deeply broken lists", "<li><li><ul></li><ol><li></ul></ol>x"],
      ["null in tag name", "<p\u0000>x</p\u0000>"],
      ["isindex/keygen/legacy", "<isindex><keygen><frame><frameset><noframes>x</noframes>"],
      ["huge attribute count", "<p " + Array.from({ length: 5000 }, (_, i) => `a${i}=v`).join(" ") + ">x</p>"],
    ];
    for (const [name, html] of nasties) {
      test(name, () => {
        expect(typeof fromHTML(html)).toBe("string");
      });
    }
    test("misnested formatting keeps all text in order", () => {
      expect(fromHTML("<p><b>a<i>b</b>c</i>d</p>").replace(/[*_]/g, "")).toBe("abcd");
    });
    test("foster-parented text keeps all words", () => {
      const md = fromHTML("<table>oops<tr><td>cell</td><td>two</td></tr></table>");
      expect(md).toContain("oops");
      expect(md).toContain("| cell | two |");
    });
  });

  describe("pathological nesting", () => {
    // Each of these is quadratic (or a stack overflow) in a naive
    // implementation. They must finish and keep the innermost text. The
    // depth is far past both the parser's tree-depth cap (512) and the point
    // where a recursive converter would exhaust the stack.
    const depth = 20_000;
    // `String.prototype.repeat` is slow in debug JSC.
    const repeat = (s: string, n: number) => Buffer.alloc(s.length * n, s).toString();
    const cases: [string, () => string][] = [
      ["div", () => repeat("<div>", depth) + "deep" + repeat("</div>", depth)],
      ["unclosed div", () => repeat("<div>", depth) + "deep"],
      ["span", () => repeat("<span>", depth) + "deep"],
      ["b", () => repeat("<b>", depth) + "deep"],
      ["ul/li", () => repeat("<ul><li>", depth / 2) + "deep"],
      ["blockquote", () => repeat("<blockquote>", depth) + "deep"],
      ["table", () => repeat("<table><tr><td>", depth / 4) + "deep"],
      ["a", () => repeat("<a href=x>", depth) + "deep"],
      [
        "custom elements with distinct names",
        () => Array.from({ length: depth }, (_, i) => `<x-${i}>`).join("") + "deep",
      ],
      ["svg", () => "<svg>" + repeat("<g>", depth) + "<text>deep</text>"],
      ["formatting elements across blocks", () => repeat("<b><i><s><u>", 500) + repeat("<p>x</p>", 2000) + "deep"],
    ];
    for (const [name, html] of cases) {
      test(name, () => {
        expect(fromHTML(html())).toContain("deep");
      });
    }
    test("content after a deep region is still structured", () => {
      const md = fromHTML(
        repeat("<div>", 5000) + "deep" + repeat("</div>", 5000) + "<h2>After</h2><ul><li>ok</li></ul>",
      );
      expect(md).toContain("deep");
      expect(md).toEndWith("## After\n\n- ok");
    });
    test("deep inline formatting keeps text in order", () => {
      const md = fromHTML(
        repeat("<em><strong>", 600) + "one <b>two</b>" + repeat("</strong></em>", 600) + "<p>three</p>",
      );
      const words = md
        .replace(/[*_\\]/g, "")
        .split(/\s+/)
        .filter(Boolean);
      expect(words).toEqual(["one", "two", "three"]);
    });
  });

  // -------------------------------------------------------------------------
  // Round trip: canonical Markdown → Bun.markdown.html() → fromHTML() should
  // give back the same Markdown. This checks the two directions agree on
  // structure without involving any third-party implementation.
  // -------------------------------------------------------------------------
  describe("round-trips Bun.markdown.html output", () => {
    const docs: [string, string][] = [
      ["headings and paragraphs", "# Title\n\nSome text here.\n\n## Sub\n\nMore text."],
      ["emphasis", "A **bold** and _em_ and `code` and ~~del~~ word."],
      ["links and images", '[Bun](https://bun.com "Bun") and ![logo](/logo.png)'],
      ["lists", "- one\n- two\n  - nested\n  - again\n- three\n\n1. a\n2. b"],
      ["loose list", "- para one\n\n  para two\n\n- next"],
      ["blockquote", "> quoted **text**\n>\n> - with\n> - list"],
      ["code block", "```js\nconst x = 1 * 2;\nif (x) {\n  y();\n}\n```"],
      ["table", "| a | b |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |"],
      ["task list", "- [x] done\n- [ ] todo"],
      ["hr", "above\n\n---\n\nbelow"],
      ["escapes", "\\*not em\\* and \\<tag> and \\_x\\_ but a_b and 3 < 4"],
      ["hard break", "line one  \nline two"],
    ];
    for (const [name, md] of docs) {
      test(name, () => {
        expect(fromHTML(Bun.markdown.html(md))).toBe(md);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Differential tests against turndown + turndown-plugin-gfm (the reference
  // rule set), configured with the same spellings as our defaults. Outputs
  // are compared after normalizing the differences we take deliberately:
  // backslash escapes, `~`/`~~`, list-marker padding, indentation width and
  // blank-line placement.
  // -------------------------------------------------------------------------
  describe("differential vs turndown", () => {
    function turndown(html: string): string {
      const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        hr: "---",
      });
      td.use(gfm);
      td.remove(["script", "style", "noscript", "template", "title", "head"]);
      return td.turndown(html);
    }
    function normalize(md: string): string[] {
      return md
        .replace(/\\(.)/g, "$1")
        .replace(/~+/g, "~")
        .split("\n")
        .map(l =>
          l
            .replace(/^(\s*)([-*+]|\d+\.)\s+/, "$1$2 ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(l => l.length > 0);
    }
    function expectEquivalent(html: string) {
      const ours = normalize(fromHTML(html));
      const theirs = normalize(turndown(html));
      if (ours.join("\n") !== theirs.join("\n")) {
        // Show the HTML in the failure so a fuzz case is reproducible.
        expect({ html, markdown: ours }).toEqual({ html, markdown: theirs });
      }
    }

    describe("curated", () => {
      const snippets: [string, string][] = [
        [
          "article",
          "<article><h1>Title</h1><p>By <a href='/me'>me</a>, <time>today</time>.</p><p>First <strong>para</strong>.</p><h2>Part</h2><p>Second.</p></article>",
        ],
        [
          "nav list of links",
          "<nav><ul><li><a href='/'>Home</a></li><li><a href='/docs'>Docs</a><ul><li><a href='/docs/a'>A</a></li></ul></li></ul></nav>",
        ],
        [
          "definition-ish markup",
          "<p><dfn>Term</dfn>: <abbr title='x'>abbr</abbr>, <cite>cite</cite>, <q>quote</q>, <mark>mark</mark>, <small>small</small></p>",
        ],
        [
          "code in links and emphasis",
          "<p><a href='/x'><code>fn()</code></a> and <em><code>y</code></em> and <strong><a href='/z'>z</a></strong></p>",
        ],
        [
          "mixed list content",
          "<ol><li><p>Para</p><pre><code>code\nblock</code></pre></li><li><blockquote>q</blockquote></li><li>plain<ul><li>n</li></ul>tail</li></ol>",
        ],
        [
          "blockquote with everything",
          "<blockquote><h3>H</h3><ul><li>a</li></ul><pre><code>x</code></pre><p>p<br>q</p></blockquote>",
        ],
        [
          "gfm table with inline markup",
          "<table><thead><tr><th><em>a</em></th><th align='right'>b</th></tr></thead><tbody><tr><td><a href='/x'>x</a></td><td><code>y|z</code></td></tr></tbody></table>",
        ],
        [
          "images and figures",
          "<figure><img src='/a.png' alt='A'><figcaption>Caption <em>here</em></figcaption></figure>",
        ],
        ["whitespace soup", "<div>\n  <p>\n    a\n    <span> b </span>\n    <b> c</b><i>d </i>\n    e\n  </p>\n</div>"],
        ["inline-block mix", "<div>text <div>block</div> more <span>inline</span><p>para</p>tail</div>"],
        [
          "headings with links (wiki style)",
          "<h2><span id='History'>History</span><span><a href='/edit'>[edit]</a></span></h2><p>x<sup><a href='#cite-1'>[1]</a></sup></p>",
        ],
        [
          "entities and unicode",
          "<p>&lt;div&gt; &amp; &quot; &#39; &nbsp; caf&eacute; 日本語 emoji 😀 &mdash; &hellip;</p>",
        ],
        [
          "line-start escapes",
          "<p>- a</p><ul><li>+ b</li><li>1. c</li></ul><h2># d</h2><blockquote>&gt; e</blockquote>",
        ],
        [
          "adjacent code blocks and hr",
          "<pre><code>a</code></pre><pre><code class='language-b'>b</code></pre><hr><hr>",
        ],
        ["strikethrough nesting", "<p><del>a <b>b</b></del> <s><a href='/x'>c</a></s></p>"],
        [
          "task list variants",
          "<ul><li><input type=checkbox checked>a</li><li><input type=checkbox> <b>b</b></li><li>c</li></ul>",
        ],
      ];
      for (const [name, html] of snippets) {
        test(name, () => expectEquivalent(html));
      }
    });

    test("Bun docs page fixture", () => {
      // bun.com/docs/runtime/markdown (this repo's own docs page) with
      // scripts, SVGs and styling attributes stripped. turndown's output for
      // it is checked in (see fixtures/regenerate-turndown.mjs) because the JS
      // converter takes seconds on a whole page under a debug build.
      const dir = join(import.meta.dir, "fixtures");
      const ours = normalize(fromHTML(readFileSync(join(dir, "bun-docs-markdown.html"), "utf8")));
      const theirs = normalize(readFileSync(join(dir, "bun-docs-markdown.turndown.md"), "utf8"));
      expect(ours).toEqual(theirs);
      // And it is real content, not two empty outputs agreeing.
      expect(ours.length).toBeGreaterThan(300);
    });

    // Seeded structural fuzzing: random documents built from the elements
    // both implementations treat the same way. The generator avoids the
    // documented deviations (br as the only content of an inline element,
    // newlines inside table cells and headings, header-less tables, bare
    // <pre>).
    describe("fuzz", () => {
      function makeRng(seed: number) {
        let s = seed >>> 0;
        return () => {
          // xorshift32
          s ^= s << 13;
          s >>>= 0;
          s ^= s >>> 17;
          s ^= s << 5;
          s >>>= 0;
          return s / 0x100000000;
        };
      }
      function generate(seed: number): string {
        const rnd = makeRng(seed);
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
        const WORDS = [
          "foo",
          "bar",
          "baz qux",
          "a*b",
          "x_y",
          "1. one",
          "- dash",
          "# hash",
          "[br]",
          "back\\slash",
          "tick`s",
          "  spaced  ",
          "\n\t nl \n",
          "&amp;",
          "&lt;tag&gt;",
          "caf\u00e9",
          "\u00a0nbsp\u00a0",
          "> gt",
          "+ plus",
          "===",
          "~~~",
          "snake_case_word",
          "&quot;q&quot;",
        ];
        const ws = () => pick(["", "", "", " ", "\n", "  \n  "]);
        const text = () => pick(WORDS) + (rnd() < 0.5 ? " " : "") + (rnd() < 0.3 ? pick(WORDS) : "");
        let oneLine = false; // inside a table cell or heading
        const inline = (d: number): string => {
          if (d > 4 || rnd() < 0.35) return text();
          let k = pick(["b", "strong", "i", "em", "code", "a", "span", "del", "br", "img", "sup", "kbd"]);
          if ((oneLine || d > 0) && k === "br") k = "span";
          if (k === "br") return "<br>";
          if (k === "img")
            return `<img src="${pick(["a.png", "", "b c.png", "x(1).png"])}" alt="${pick(["alt", "", "a*b"])}"${rnd() < 0.3 ? ' title="t"' : ""}>`;
          if (k === "a")
            return `<a${rnd() < 0.9 ? ` href="${pick(["/x", "http://e.com/a b", "", "#f(1)"])}"` : ""}${!oneLine && rnd() < 0.2 ? ' title="T\n  t"' : ""}>${ws()}${inline(d + 1)}${ws()}</a>`;
          return `<${k}>${ws()}${inline(d + 1)}${rnd() < 0.4 ? inline(d + 1) : ""}${ws()}</${k}>`;
        };
        const inlines = (d: number) => {
          let s = "";
          const n = 1 + Math.floor(rnd() * 3);
          for (let i = 0; i < n; i++) s += inline(d) + ws();
          return s;
        };
        const block = (d: number): string => {
          if (d > 3 || rnd() < 0.25) return `<p>${ws()}${inlines(0)}${ws()}</p>`;
          const k = pick([
            "div",
            "h1",
            "h2",
            "h3",
            "blockquote",
            "ul",
            "ol",
            "pre",
            "hr",
            "table",
            "section",
            "p",
            "dl",
          ]);
          switch (k) {
            case "hr":
              return "<hr>";
            case "h1":
            case "h2":
            case "h3": {
              oneLine = true;
              const h = `<${k}>${inlines(0)}</${k}>`;
              oneLine = false;
              return h;
            }
            case "pre":
              return `<pre><code${rnd() < 0.5 ? ' class="language-js"' : ""}>${pick(["let x = 1;\n  y();\n", "```\ninner\n```", "plain", "a\n\n\nb\n"])}</code></pre>`;
            case "ul":
            case "ol": {
              let s = `<${k}${k === "ol" && rnd() < 0.3 ? ' start="4"' : ""}>`;
              const n = 1 + Math.floor(rnd() * 3);
              for (let i = 0; i < n; i++)
                s += `${ws()}<li>${ws()}${rnd() < 0.6 ? inlines(0) : block(d + 1) + (rnd() < 0.5 ? block(d + 1) : "")}${rnd() < 0.3 ? `<ul><li>n1</li><li>n2</li></ul>` : ""}${ws()}</li>${ws()}`;
              return s + `</${k}>`;
            }
            case "table": {
              oneLine = true;
              const cols = 1 + Math.floor(rnd() * 3);
              let s = "<table><thead><tr>";
              for (let c = 0; c < cols; c++) s += `<th${rnd() < 0.3 ? ' align="center"' : ""}>${inline(2)}</th>`;
              s += "</tr></thead><tbody>";
              const rows = 1 + Math.floor(rnd() * 2);
              for (let r = 0; r < rows; r++) {
                s += "<tr>";
                for (let c = 0; c < cols; c++) s += `<td>${inline(2)}</td>`;
                s += "</tr>";
              }
              oneLine = false;
              return s + "</tbody></table>";
            }
            case "dl":
              return `<dl><dt>${inlines(0)}</dt><dd>${inlines(0)}</dd></dl>`;
            default: {
              let s = `<${k}>${ws()}`;
              const n = 1 + Math.floor(rnd() * 3);
              for (let i = 0; i < n; i++) s += (rnd() < 0.3 ? inlines(0) : block(d + 1)) + ws();
              return s + `</${k}>`;
            }
          }
        };
        let s = "";
        const n = 1 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) s += block(0) + ws();
        return s;
      }

      // Whitespace-only `<del>` (turndown emits bare `~~`, we emit nothing)
      // is the one deviation the generator can still hit; skip those cases.
      const deviates = (html: string) => /~\s*~/.test(turndown(html).replace(/\\./g, ""));

      for (let seed = 1; seed <= 250; seed++) {
        test(`seed ${seed}`, () => {
          const html = generate(seed);
          if (deviates(html)) return;
          expectEquivalent(html);
        });
      }
    });
  });
});

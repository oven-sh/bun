import { describe, expect, test } from "bun:test";

/**
 * GFM Compatibility Tests
 *
 * These tests verify areas where md4c (and Bun's markdown parser derived from it)
 * differs from cmark-gfm (the reference GFM implementation). Expected outputs were
 * generated using cmark-gfm 0.29.0.gfm.13 with the appropriate extensions.
 *
 * Each section corresponds to a known incompatibility between md4c and GFM.
 */

const md = Bun.markdown;

function render(input: string, options?: Record<string, boolean>): string {
  return md.html(input + "\n", options ?? {});
}

function renderGFM(md: string): string {
  return render(md, {
    tables: true,
    strikethrough: true,
    tasklists: true,
    permissive_autolinks: true,
    tag_filter: true,
  });
}

// Normalize HTML for comparison: collapse whitespace, normalize tags
function normalize(html: string): string {
  return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
}

// ============================================================================
// 1. Tables Cannot Interrupt Paragraphs
//
// In GFM (cmark-gfm), a table can appear immediately after paragraph text
// without a blank line separator. md4c requires a blank line before a table.
//
// References: md4c issues #262, #282
// ============================================================================
describe("tables interrupting paragraphs", () => {
  test("table immediately after paragraph text", () => {
    const md = `Some paragraph text.
| Col 1 | Col 2 |
|-------|-------|
| a     | b     |`;

    // cmark-gfm: paragraph + table
    const expected = normalize(`<p>Some paragraph text.</p>
<table>
<thead>
<tr>
<th>Col 1</th>
<th>Col 2</th>
</tr>
</thead>
<tbody>
<tr>
<td>a</td>
<td>b</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("table after blank line works in both", () => {
    const md = `Some paragraph text.

| Col 1 | Col 2 |
|-------|-------|
| a     | b     |`;

    const expected = normalize(`<p>Some paragraph text.</p>
<table>
<thead>
<tr>
<th>Col 1</th>
<th>Col 2</th>
</tr>
</thead>
<tbody>
<tr>
<td>a</td>
<td>b</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("table interrupts paragraph with multiple rows", () => {
    const md = `Hello world
| a | b | c |
|---|---|---|
| 1 | 2 | 3 |
| 4 | 5 | 6 |`;

    const expected = normalize(`<p>Hello world</p>
<table>
<thead>
<tr>
<th>a</th>
<th>b</th>
<th>c</th>
</tr>
</thead>
<tbody>
<tr>
<td>1</td>
<td>2</td>
<td>3</td>
</tr>
<tr>
<td>4</td>
<td>5</td>
<td>6</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });
});

// ============================================================================
// 2. Table Header/Delimiter Column Count Mismatch
//
// GFM rejects a table entirely if the header row and delimiter row have
// different column counts — it renders as a plain paragraph. md4c is more
// permissive and accepts the table using only the columns from the delimiter.
//
// Reference: md4c issue #137
// ============================================================================
describe("table column count mismatch", () => {
  test("more header columns than delimiter columns", () => {
    const md = `| abc | def |
| --- |
| bar |`;

    // cmark-gfm: rejects as table, renders as paragraph
    const expected = normalize(`<p>| abc | def |
| --- |
| bar |</p>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("fewer header columns than delimiter columns", () => {
    const md = `| abc |
| --- | --- |
| bar | baz |`;

    const expected = normalize(`<p>| abc |
| --- | --- |
| bar | baz |</p>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("three header columns, two delimiter columns", () => {
    const md = `| a | b | c |
| --- | --- |
| 1 | 2 | 3 |`;

    const expected = normalize(`<p>| a | b | c |
| --- | --- |
| 1 | 2 | 3 |</p>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("one header column, three delimiter columns", () => {
    const md = `| a |
| --- | --- | --- |
| 1 |`;

    const expected = normalize(`<p>| a |
| --- | --- | --- |
| 1 |</p>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });
});

// ============================================================================
// 3. Pipes Inside Code Spans in Tables
//
// In cmark-gfm, pipe characters inside backtick code spans within table rows
// are treated as cell delimiters (code spans do NOT take precedence over
// table cell boundaries). md4c treats code spans as higher precedence.
//
// Reference: md4c issues #136, #262
// ============================================================================
describe("pipes in code spans in tables", () => {
  test("pipe in code span splits cell in GFM", () => {
    const md = `| Column 1 | Column 2 |
|---------|---------|
| \`foo | bar\` | baz |`;

    // cmark-gfm: the pipe inside backticks acts as a cell delimiter
    // so `foo becomes cell 1, bar` becomes cell 2
    const expected = normalize(`<table>
<thead>
<tr>
<th>Column 1</th>
<th>Column 2</th>
</tr>
</thead>
<tbody>
<tr>
<td>\`foo</td>
<td>bar\`</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("escaped pipe in code span preserves code span", () => {
    const md = `| Column 1 | Column 2 |
|---------|---------|
| \`foo \\| bar\` | baz |`;

    // cmark-gfm: the escaped pipe is not a delimiter, code span is preserved
    const expected = normalize(`<table>
<thead>
<tr>
<th>Column 1</th>
<th>Column 2</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>foo | bar</code></td>
<td>baz</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("multiple pipes in code span", () => {
    const md = `| a | b |
|---|---|
| \`x | y | z\` | w |`;

    // cmark-gfm: pipes in backticks are cell delimiters
    const expected = normalize(`<table>
<thead>
<tr>
<th>a</th>
<th>b</th>
</tr>
</thead>
<tbody>
<tr>
<td>\`x</td>
<td>y</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("code span with pipe as second cell value", () => {
    const md = `| a | b |
|---|---|
| \`code\` | \`a|b\` |`;

    // cmark-gfm: pipe in second cell's backticks splits the cell
    const expected = normalize(`<table>
<thead>
<tr>
<th>a</th>
<th>b</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>code</code></td>
<td>\`a</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });
});

// ============================================================================
// 4. Empty Table Body (No Data Rows)
//
// When a table has only a header row and no body rows, GFM omits the <tbody>
// tags entirely. md4c includes empty <tbody></tbody> tags.
//
// Reference: md4c issue #138
// ============================================================================
describe("empty table body", () => {
  test("table with header only omits tbody", () => {
    const md = `| abc | def |
| --- | --- |`;

    // cmark-gfm: no <tbody> at all
    const expected = normalize(`<table>
<thead>
<tr>
<th>abc</th>
<th>def</th>
</tr>
</thead>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("table with header followed by blank line omits tbody", () => {
    const md = `| abc | def |
| --- | --- |

Next paragraph.`;

    const expected = normalize(`<table>
<thead>
<tr>
<th>abc</th>
<th>def</th>
</tr>
</thead>
</table>
<p>Next paragraph.</p>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });
});

// ============================================================================
// 5. Disallowed Raw HTML (Tagfilter)
//
// GFM spec section 6.11: nine specific HTML tags have their leading `<`
// replaced with `&lt;` to prevent rendering. md4c has no equivalent — it
// either allows all HTML or disables all HTML.
//
// Filtered tags: script, style, iframe, textarea, title, plaintext, xmp,
// noframes, noembed
// ============================================================================
describe("disallowed raw HTML (tagfilter)", () => {
  // NOTE: Bun's markdown parser would need a new tagfilter option to support
  // this. These tests document the expected GFM behavior.

  test("script tag is filtered", () => {
    const md = `<script>alert("xss")</script>`;
    const expected = `&lt;script>alert("xss")&lt;/script>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("style tag is filtered", () => {
    const md = `<style>body{color:red}</style>`;
    const expected = `&lt;style>body{color:red}&lt;/style>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("iframe tag is filtered", () => {
    const md = `<iframe src="https://example.com"></iframe>`;
    const expected = `&lt;iframe src="https://example.com">&lt;/iframe>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("textarea tag is filtered", () => {
    const md = `<textarea>hello</textarea>`;
    const expected = `&lt;textarea>hello&lt;/textarea>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("title tag is filtered", () => {
    const md = `<title>hi</title>`;
    const expected = `&lt;title>hi&lt;/title>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("plaintext tag is filtered", () => {
    const md = `<plaintext>stuff`;
    const expected = `<p>&lt;plaintext>stuff</p>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("xmp tag is filtered", () => {
    const md = `<xmp>stuff</xmp>`;
    const expected = `<p>&lt;xmp>stuff&lt;/xmp></p>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("noframes tag is filtered", () => {
    const md = `<noframes>stuff</noframes>`;
    const expected = `&lt;noframes>stuff&lt;/noframes>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("noembed tag is filtered", () => {
    const md = `<noembed>stuff</noembed>`;
    const expected = `<p>&lt;noembed>stuff&lt;/noembed></p>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("allowed tags pass through unchanged", () => {
    const md = `<strong>bold</strong> and <em>italic</em>`;
    const expected = `<p><strong>bold</strong> and <em>italic</em></p>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("filtering is case insensitive", () => {
    const md = `<SCRIPT>alert("xss")</SCRIPT>`;
    const expected = `&lt;SCRIPT>alert("xss")&lt;/SCRIPT>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("tagfilter in inline context", () => {
    const md = `hello <script>alert("xss")</script> world`;
    const expected = `<p>hello &lt;script>alert("xss")&lt;/script> world</p>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("self-closing filtered tag", () => {
    const md = `<script />`;
    const expected = `&lt;script />`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("filtered tag with attributes", () => {
    const md = `<script type="text/javascript">`;
    const expected = `&lt;script type="text/javascript">`;
    expect(renderGFM(md).trim()).toBe(expected);
  });

  test("similar tag names are not filtered", () => {
    const md = `<scripting>not filtered</scripting>`;
    const expected = `<p><scripting>not filtered</scripting></p>`;
    expect(renderGFM(md).trim()).toBe(expected);
  });
});

// ============================================================================
// 6. Autolinks with Formatting Delimiters in URLs
//
// md4c incorrectly treats ~, *, ** inside URLs as span delimiters, which can
// corrupt parser state and produce unbalanced/invalid output.
//
// Reference: md4c issues #294, #251
// ============================================================================
describe("autolinks with special characters", () => {
  test("tilde in URL path", () => {
    const md = `https://example.com/~user/file`;
    const expected = `<p><a href="https://example.com/~user/file">https://example.com/~user/file</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("asterisk in URL path", () => {
    const md = `https://example.com/path*file`;
    const expected = `<p><a href="https://example.com/path*file">https://example.com/path*file</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("double asterisk in URL path", () => {
    const md = `https://example.com/**path`;
    const expected = `<p><a href="https://example.com/**path">https://example.com/**path</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("tilde in URL followed by text", () => {
    const md = `Visit https://example.com/~user then go home`;
    const expected = `<p>Visit <a href="https://example.com/~user">https://example.com/~user</a> then go home</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("multiple tildes in URL path", () => {
    const md = `https://example.com/~user1/~user2/file`;
    const expected = `<p><a href="https://example.com/~user1/~user2/file">https://example.com/~user1/~user2/file</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("plus sign in URL path", () => {
    const md = `https://codereview.qt-project.org/c/qt/qtwayland/+/545836`;
    const expected = `<p><a href="https://codereview.qt-project.org/c/qt/qtwayland/+/545836">https://codereview.qt-project.org/c/qt/qtwayland/+/545836</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("URL autolink not preceded by alphanumeric", () => {
    const md = `texthttp://example.com`;
    // cmark-gfm: does NOT autolink because preceded by alpha
    const expected = `<p>texthttp://example.com</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });
});

// ============================================================================
// 7. Autolink Parenthesis Balancing and Trailing Punctuation
//
// GFM has complex rules for parenthesis balancing in URLs and stripping
// trailing punctuation. These are areas where parsers commonly diverge.
//
// Reference: md4c issue #135 (fixed), GFM spec section 6.9
// ============================================================================
describe("autolink parentheses and trailing punctuation", () => {
  test("balanced parentheses in URL are preserved", () => {
    const md = `www.google.com/search?q=Markup+(business)`;
    const expected = `<p><a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("unbalanced closing paren with trailing text", () => {
    const md = `www.google.com/search?q=(business))+ok`;
    const expected = `<p><a href="http://www.google.com/search?q=(business))+ok">www.google.com/search?q=(business))+ok</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("URL ending in paren wrapped in parens strips outer paren", () => {
    const md = `(www.google.com/search?q=Markup+(business))`;
    const expected = `<p>(<a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a>)</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("entity-like suffix excluded from URL", () => {
    const md = `www.google.com/search?q=commonmark&hl;`;
    const expected = `<p><a href="http://www.google.com/search?q=commonmark">www.google.com/search?q=commonmark</a>&amp;hl;</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("less-than terminates autolink", () => {
    const md = `www.example.com<more`;
    const expected = `<p><a href="http://www.example.com">www.example.com</a>&lt;more</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("trailing period stripped from URL", () => {
    const md = `Visit www.commonmark.org.`;
    const expected = `<p>Visit <a href="http://www.commonmark.org">www.commonmark.org</a>.</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("email autolink with trailing period excluded", () => {
    const md = `Email foo@bar.baz.`;
    const expected = `<p>Email <a href="mailto:foo@bar.baz">foo@bar.baz</a>.</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("www autolink at start of line", () => {
    const md = `www.example.com/path`;
    const expected = `<p><a href="http://www.example.com/path">www.example.com/path</a></p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });

  test("email autolink in sentence", () => {
    const md = `Contact foo@bar.baz for info`;
    const expected = `<p>Contact <a href="mailto:foo@bar.baz">foo@bar.baz</a> for info</p>`;
    expect(normalize(render(md, { permissive_autolinks: true }))).toBe(normalize(expected));
  });
});

// ============================================================================
// 8. Strikethrough Edge Cases
//
// - GFM spec formally requires ~~ (double tilde), but GitHub.com also accepts
//   ~ (single tilde). md4c and cmark-gfm both accept single tildes.
// - Flanking delimiter rules apply to tildes.
// - Strikethrough does not span across paragraph boundaries.
//
// Reference: md4c issues #242, #243
// ============================================================================
describe("strikethrough edge cases", () => {
  test("double tilde strikethrough", () => {
    const md = `~~strikethrough~~`;
    const expected = `<p><del>strikethrough</del></p>`;
    expect(normalize(render(md, { strikethrough: true }))).toBe(normalize(expected));
  });

  test("single tilde strikethrough", () => {
    const md = `~strikethrough~`;
    const expected = `<p><del>strikethrough</del></p>`;
    expect(normalize(render(md, { strikethrough: true }))).toBe(normalize(expected));
  });

  test("tilde adjacent to quotes does not trigger strikethrough", () => {
    const md = `copy "~user1/file" to "~user2/file"`;
    // cmark-gfm: no strikethrough due to flanking rules
    const expected = `<p>copy &quot;~user1/file&quot; to &quot;~user2/file&quot;</p>`;
    expect(normalize(render(md, { strikethrough: true }))).toBe(normalize(expected));
  });

  test("strikethrough does not span across paragraphs", () => {
    const md = `This ~~has a

new paragraph~~.`;
    const expected = normalize(`<p>This ~~has a</p>
<p>new paragraph~~.</p>`);
    expect(normalize(render(md, { strikethrough: true }))).toBe(expected);
  });

  test("triple tilde is treated as code fence, not strikethrough", () => {
    const md = `~~~not strikethrough~~~`;
    // cmark-gfm: treated as a code fence with "not" as the info string
    const expected = normalize(`<pre><code class="language-not"></code></pre>`);
    expect(normalize(render(md, { strikethrough: true }))).toBe(expected);
  });
});

// ============================================================================
// 9. Code Fence Closing with Tab
//
// CommonMark spec: the closing code fence "may be followed only by spaces or
// tabs, which are ignored." md4c may fail to recognize a closing fence
// followed by a tab.
//
// Reference: md4c issue #292
// ============================================================================
describe("code fence closing with tab", () => {
  test("closing fence followed by tab", () => {
    const md = "```\ncode here\n```\t";
    const expected = normalize(`<pre><code>code here
</code></pre>`);
    expect(normalize(render(md))).toBe(expected);
  });

  test("closing fence followed by spaces", () => {
    const md = "```\ncode here\n```   ";
    const expected = normalize(`<pre><code>code here
</code></pre>`);
    expect(normalize(render(md))).toBe(expected);
  });

  test("closing fence followed by tab and spaces", () => {
    const md = "```\ncode here\n```\t  ";
    const expected = normalize(`<pre><code>code here
</code></pre>`);
    expect(normalize(render(md))).toBe(expected);
  });
});

// ============================================================================
// 10. ATX Heading + Emphasis Interactions
//
// md4c can mishandle emphasis markers in headings combined with inline links
// containing underscores, producing malformed output.
//
// Reference: md4c issue #278
// ============================================================================
describe("heading emphasis interactions", () => {
  test("underscore emphasis in heading with link", () => {
    const md = `# _foo [bar_](/url)`;
    // cmark-gfm: underscores don't form emphasis here
    const expected = normalize(`<h1>_foo <a href="/url">bar_</a></h1>`);
    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("asterisk emphasis in heading with link", () => {
    const md = `# *foo [bar*](/url)`;
    const expected = normalize(`<h1>*foo <a href="/url">bar*</a></h1>`);
    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("underscores in link URL inside heading", () => {
    const md = `# heading [link_text](http://example.com/foo_bar)`;
    const expected = normalize(`<h1>heading <a href="http://example.com/foo_bar">link_text</a></h1>`);
    expect(normalize(renderGFM(md))).toBe(expected);
  });
});

// ============================================================================
// 11. Combined GFM Extensions
//
// Test that multiple GFM extensions work correctly together.
// ============================================================================
describe("combined GFM extensions", () => {
  test("table with strikethrough and autolinks in cells", () => {
    const md = `| Feature | Status |
|---------|--------|
| ~~old~~ | https://example.com |
| new | www.example.com |`;

    const expected = normalize(`<table>
<thead>
<tr>
<th>Feature</th>
<th>Status</th>
</tr>
</thead>
<tbody>
<tr>
<td><del>old</del></td>
<td><a href="https://example.com">https://example.com</a></td>
</tr>
<tr>
<td>new</td>
<td><a href="http://www.example.com">www.example.com</a></td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("table without leading/trailing pipes", () => {
    const md = `abc | def
--- | ---
bar | baz`;

    const expected = normalize(`<table>
<thead>
<tr>
<th>abc</th>
<th>def</th>
</tr>
</thead>
<tbody>
<tr>
<td>bar</td>
<td>baz</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });

  test("table with alignment", () => {
    const md = `| left | center | right |
|:-----|:------:|------:|
| a    | b      | c     |`;

    const expected = normalize(`<table>
<thead>
<tr>
<th align="left">left</th>
<th align="center">center</th>
<th align="right">right</th>
</tr>
</thead>
<tbody>
<tr>
<td align="left">a</td>
<td align="center">b</td>
<td align="right">c</td>
</tr>
</tbody>
</table>`);

    expect(normalize(renderGFM(md))).toBe(expected);
  });
});

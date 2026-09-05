import { expect, test } from "bun:test";
import { syntaxHighlight } from "../../src/runtime/bake/client/JavaScriptSyntaxHighlighter";

// The dev server error overlay renders one source line at a time through
// syntaxHighlight(). It returns the span-wrapped tokens of that line with no
// <pre>/<div> wrapper, and every token body is HTML-escaped.
test("syntaxHighlight returns escaped, span-wrapped tokens for one line", () => {
  expect(syntaxHighlight('const name = "<b>" // note')).toMatchInlineSnapshot(
    `"<span class="syntax-pink">const</span> <span class="syntax-fg">name</span> <span class="syntax-pink">=</span> <span class="syntax-yellow">&quot;&lt;b&gt;&quot;</span> <span class="syntax-gray">// note</span>"`,
  );
});

test("syntaxHighlight drops newlines instead of emitting line wrappers", () => {
  expect(syntaxHighlight("let a = 1;\nlet b = 2;")).toMatchInlineSnapshot(
    `"<span class="syntax-pink">let</span> <span class="syntax-fg">a</span> <span class="syntax-pink">=</span> <span class="syntax-purple">1</span><span class="syntax-pink">;</span><span class="syntax-pink">let</span> <span class="syntax-fg">b</span> <span class="syntax-pink">=</span> <span class="syntax-purple">2</span><span class="syntax-pink">;</span>"`,
  );
});

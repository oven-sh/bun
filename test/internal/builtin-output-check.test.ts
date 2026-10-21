// src/codegen/builtin-parser.ts preprocesses src/js with a tokenizer: it rewrites
// `$name` to `__intrinsic__name` in code and copies literals. It cannot tell a
// regex literal from a division after `)` or `}`. bundle-modules.ts and
// bundle-functions.ts pass its output to checkPreprocessedSource, which fails the
// build when the TypeScript parser finds a rewrite inside a literal, or code that
// the preprocessor left as written. (typescript comes from the root install, like
// at build time.)
import { expect, test } from "bun:test";
import { checkPreprocessedSource } from "../../src/codegen/builtin-output-check.ts";

const check = (text: string, firstLine?: number) => () => checkPreprocessedSource("src/js/example.ts", text, firstLine);

// What the preprocessor makes of: a regex and a template literal with `$a` in them, `$debug(..)`,
// `$assert(..)`, `throw new TypeError(..)`, `throw new RangeError(..)`, `export default` and `require(..)`.
test("accepts preprocessed code", () => {
  const text = [
    "const re = x ? /[$a]/ : !/[$a]/.test(`${__intrinsic__b} \\`$a\\``);",
    "(IS_BUN_DEVELOPMENT?$debug_log('$a', __intrinsic__b):void 0);",
    `!(IS_BUN_DEVELOPMENT?$assert(__intrinsic__b,"$b", '$a'):void 0);`,
    "if (!re) __intrinsic__throwTypeError('$a');",
    "if (!re) __intrinsic__throwRangeError('$a');",
    `__intrinsic__exports = { re, half: __intrinsic__b / 2 / __intrinsic__c, fs: load("node:fs") };`,
  ].join("\n");
  expect(check(text)).not.toThrow();
});

test.each([
  ["a regex literal", "if (x) /[__intrinsic__a]/.test(y);", "/[__intrinsic__a]/"],
  ["a string", "x = '__intrinsic__a';", "'__intrinsic__a'"],
  ["a template literal", "x = `a __intrinsic__b`;", "`a __intrinsic__b`"],
  ["a template head", "x = `a __intrinsic__b ${y} c`;", "`a __intrinsic__b ${"],
  ["a template middle", "x = `${y} __intrinsic__a ${z}`;", "} __intrinsic__a ${"],
  ["a template tail", "x = `${y} __intrinsic__a`;", "} __intrinsic__a`"],
])("reports a rewrite inside %s", (_, text, shown) => {
  expect(check(text)).toThrow(`src/js/example.ts:1: the preprocessor rewrote text inside this literal: ${shown}\n`);
});

// What the tokenizer made of the help text in src/js/internal/bake.ts when `\`` ended a template: the source says
// `export default`. The report names the line of the rewrite, not the line where the literal starts.
test("reports the line of a rewrite inside a template literal of many lines", () => {
  const text =
    "const help = `\nBun v${version} (bake)\n\n  as for \\`__intrinsic__exports =\\` in \\`bun app.ts\\`\n`;";
  expect(check(text)).toThrow(
    "src/js/example.ts:4: the preprocessor rewrote text inside this literal: as for \\`__intrinsic__exports =\\` in \\`bun app.ts\\`\n",
  );
});

test.each([
  ["$b();", "did not rewrite this `$name`: $b"],
  [`require("node:fs");`, `did not replace this require(): require("node:fs")`],
  ["export default y;", "did not rewrite this `export default`: export default y;"],
  ["export default function z() {}", "did not rewrite this `export default`: export default function z() {}"],
  ["new TypeError(y);", "did not rewrite this `new TypeError`: new TypeError(y)"],
  ["throw new RangeError(y);", "did not rewrite this `throw new RangeError`: throw new RangeError(y);"],
])("reports code left as written: %s", (text, problem) => {
  expect(check(text)).toThrow(`src/js/example.ts:1: the preprocessor ${problem}`);
});

test("reports code left as written at its first line, and shows that line", () => {
  expect(check("x = 1;\nexport default {\n  a: __intrinsic__b,\n};")).toThrow(
    "src/js/example.ts:2: the preprocessor did not rewrite this `export default`: export default {\nbuiltin-parser.ts",
  );
});

test("reports the line in the source file", () => {
  expect(check("__intrinsic__b();\n$b();", 10)).toThrow("src/js/example.ts:11: the preprocessor did not");
  expect(check("function f() {\n  x = `a\n  __intrinsic__b c\nd`;\n}", 10)).toThrow(
    "src/js/example.ts:12: the preprocessor rewrote text inside this literal: __intrinsic__b c\n",
  );
});

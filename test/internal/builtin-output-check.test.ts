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
  ["a regex literal", "if (x) /[__intrinsic__a]/.test(y);", "1:8", "/[__intrinsic__a]/"],
  ["a string", "x = '__intrinsic__a';", "1:5", "'__intrinsic__a'"],
  ["template text", "x = `${y} __intrinsic__a`;", "1:9", "} __intrinsic__a`"],
])("reports a rewrite inside %s", (_, text, position, shown) => {
  expect(check(text)).toThrow(
    `src/js/example.ts:${position}: the preprocessor rewrote a \`$name\` inside this literal: ${shown}`,
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
  expect(check(text)).toThrow(`src/js/example.ts:1:1: the preprocessor ${problem}`);
});

test("reports the line in the source file", () => {
  expect(check("__intrinsic__b();\n$b();", 10)).toThrow("src/js/example.ts:11:1: the preprocessor did not");
});

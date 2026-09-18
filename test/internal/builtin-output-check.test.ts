// src/codegen/builtin-parser.ts preprocesses src/js with a tokenizer: it rewrites
// `$name` to `__intrinsic__name` in code and copies literals. It cannot tell a
// regex literal from a division after `)` or `}`. bundle-modules.ts and
// bundle-functions.ts pass its output to checkPreprocessedSource, which fails the
// build when the TypeScript parser finds a rewrite inside a literal or a `$name`
// left in code. (typescript comes from the root install, like at build time.)
import { expect, test } from "bun:test";
import { checkPreprocessedSource } from "../../src/codegen/builtin-output-check.ts";
import { sliceSourceCode } from "../../src/codegen/builtin-parser.ts";

function check(source: string, firstLine?: number) {
  const { result, rest } = sliceSourceCode(`{${source}}`, true);
  expect(rest).toBe("");
  return () => checkPreprocessedSource("src/js/example.ts", result.slice(1, -1), firstLine);
}

test("accepts what the preprocessor reads right", () => {
  const source = [
    "const re = x ? /[$a]/ : !/[$a]/.test(`${$b} \\`$a\\``);",
    "$debug('$a', $b);",
    "$assert($b, '$a');",
    "export default { re, half: $b / 2 / $c };",
  ].join("\n");
  expect(check(source)).not.toThrow();
});

test("reports a regex literal that the preprocessor read as code", () => {
  expect(check("$b();\nif (x) /[$a]/.test(y);", 10)).toThrow(
    "src/js/example.ts:11:8: the preprocessor read this literal as code and rewrote a `$name` in it: /[__intrinsic__a]/",
  );
});

test("reports code that the preprocessor read as a comment", () => {
  // After `)` the regex literal is read as code, so the `//` in it opens a line comment.
  expect(check("if (x) /a\\/\\//.test(y) && $b();")).toThrow(
    "src/js/example.ts:1:27: the preprocessor read this code as a literal and did not rewrite `$b`: $b",
  );
});

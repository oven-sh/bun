// Pairs of source texts for `bun-lint utils-core adjacent`, and what ESLint's `canTokensBeAdjacent` says about them.
//
//   ESLINT_DIR=<eslint checkout> bun adjacent.ts pairs.jsonl expected.txt
//   bun-lint utils-core adjacent pairs.jsonl | diff - expected.txt

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const eslintDir = process.env.ESLINT_DIR;
if (!eslintDir) throw new Error("set ESLINT_DIR");
const astUtils = createRequire(join(eslintDir, "package.json"))("./lib/rules/utils/ast-utils.js");

const texts = [
  "foo", "typeof", "in", "this", "null", "true", "let", "await", "\\u0061", "é", "#x", "a.#x",
  "1", "1.", ".5", "1.5", "0x1", "1n", "1e3", "1_000",
  "'a'", '"a"', "`a`", "`a${b}`", "`a${b}c${d}e`", "`${{}}`", "a`b`", "`a${`b${c}`}`",
  "/a/", "/a/g", "/[/]/", "a / b", "a /b/ c", "(a) / b", "x = /a/", "typeof /a/", "a++ / b", "/\\//",
  "+", "++", "-", "--", "/", "*", "**", "=", "=>", "...", ".", "?.", "(", ")", "[", "]", "{", "}", ";", ",", "!", "~", "<", ">>>=",
  "a+", "+a", "a++", "++a", "a-", "-a", "a--", "--a", "a/", "/a", "a.", ".a",
  "//a", "/*a*/", "a//b", "a/*b*/", "/*a*/b", "//a\nb", "a\n//b", "/*a*/ /*b*/", "a /*b*/ ", " /*a*/ b", "/**/", "a // b\n",
  "#!foo", "#!foo\nbar", " a ", "a b", "a\u2028b", "'a", "`a", "/*a", "/a", "'a\\\nb'", "'a\\'b'", "{a}", "{`}`}", "a ? b : c", "function(){}", "class{}", "({})", "[1]",
];
const pairs: string[] = [];
const expected: string[] = [];
for (const left of texts) {
  for (const right of texts) {
    let result;
    try {
      result = astUtils.canTokensBeAdjacent(left, right);
    } catch {
      continue;
    }
    pairs.push(JSON.stringify([left, right]));
    expected.push(String(result));
  }
}
writeFileSync(process.argv[2], pairs.join("\n") + "\n");
writeFileSync(process.argv[3], expected.join("\n") + "\n");

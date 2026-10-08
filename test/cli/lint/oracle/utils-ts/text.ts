// Compares the helpers of `bun_lint::utils::ts_utils` that take text with typescript-eslint's.
//
//   TYPESCRIPT_ESLINT=<checkout, built> bun text.ts <bun-lint> <scratch directory>
//
// Writes `text.tsv`, a line for each call: the name of the helper and its arguments in hexadecimal, separated by tabs.
// `bun-lint utils-ts text text.tsv` prints a line of JSON for each.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.TYPESCRIPT_ESLINT!;
const util = require(join(root, "packages/eslint-plugin/dist/util/index.js"));
const { getWrappedCode } = require(join(root, "packages/eslint-plugin/dist/util/getWrappedCode.js"));
const [binary, scratch] = process.argv.slice(2);

const calls: [string, string[], unknown][] = [];
const call = (name: string, args: string[], result: unknown) => calls.push([name, args, result]);

// Every character of the BMP that is not half of a surrogate pair, and some beyond it, first and later in a name.
for (let c = 0; c < 0x10000; c++) {
  if (c >= 0xd800 && c < 0xe000) continue;
  const text = String.fromCharCode(c);
  call("requiresQuoting", [text], util.requiresQuoting(text));
  call("requiresQuoting", ["a" + text], util.requiresQuoting("a" + text));
}
const samples = [
  "", "a", "ab c", "\n", "\r\n", "a\r\nb", "\t", "\x7f", "\x80", "é", "é", "👍", "👍🏽", "👨‍👩‍👧‍👦", "🇯🇵🇫🇷", "한국어", "각", "क्षि", "a‍b",
  "𠮷", "𝒳y", "$", "_a", "a-b", "1a", "a1", "ℂ", "℘", "℮", "゛", "·", "a·", "a·", "a፩", "a᧚",
];
for (const text of samples) {
  call("getStringLength", [text], util.getStringLength(text));
  call("requiresQuoting", [text], util.requiresQuoting(text));
  if (text) call("upperCaseFirst", [text], util.upperCaseFirst(text));
}
for (const name of [
  "a.ts", "a.d.ts", "a.D.TS", "a.d.cts", "a.d.mts", "a.d.tsx", "a.d.css.ts", "a.d..ts", "a.d.ts.ts", ".d.ts", "d.ts", "a.d.ts/b.ts", "a.d.js",
  "a.d.x.cts", "a.d.x.TS", "a.dd.ts", "a.d.", ".d.", "", "a.d.ts ", "x.d.a.b.ts", "a.d.json.ts", "a.d.mts.ts", "İ.d.ts",
]) {
  call("isDefinitionFile", [name], util.isDefinitionFile(name));
}
for (const words of [[], ["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"], ["", ""], ["é", "ü", "ö"]]) {
  call("formatWordList", words, util.formatWordList(words));
}
for (const text of ["", "a", "a.b", "\\^$.*+?()[]{}|", "a-b", "/", "é.", "a b"]) {
  call("escapeRegExp", [text], require(join(root, "packages/eslint-plugin/dist/util/escapeRegExp.js")).escapeRegExp(text));
}
for (let a = -1; a <= 20; a++) {
  for (let b = -1; b <= 20; b++) call("getWrappedCode", ["x", String(a), String(b)], getWrappedCode("x", a, b));
}

mkdirSync(scratch, { recursive: true });
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
writeFileSync(join(scratch, "text.tsv"), calls.map(([name, args]) => [name, ...args.map(hex)].join("\t")).join("\n") + "\n");
const actual = Bun.spawnSync([binary, "utils-ts", "text", join(scratch, "text.tsv")]).stdout.toString().split("\n");
let wrong = 0;
calls.forEach(([name, args, want], i) => {
  if (actual[i] === JSON.stringify(want)) return;
  if (wrong++ < 20) console.log(`${name}(${args.map(it => JSON.stringify(it)).join(", ")}): expected ${JSON.stringify(want)}, actual ${actual[i]}`);
});
console.log(`${calls.length} calls, ${wrong} differ`);

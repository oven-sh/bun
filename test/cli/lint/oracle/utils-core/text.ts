// Pairs of strings for `bun-lint utils-core text`, and what JavaScript makes of them.
//
//   ESLINT_DIR=<eslint checkout> bun text.ts <cases.jsonl of ../semantic/cases.ts> pairs.jsonl expected.jsonl
//   bun-lint utils-core text pairs.jsonl | diff - expected.jsonl

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const eslintDir = process.env.ESLINT_DIR;
if (!eslintDir) throw new Error("set ESLINT_DIR");
const fromEslint = createRequire(join(eslintDir, "package.json"));
const astUtils = fromEslint("./lib/rules/utils/ast-utils.js");
const escapeStringRegexp = fromEslint("escape-string-regexp");
// `Number(text)` as V8 has it, on which ESLint runs. JavaScriptCore adds the digits of `0b` and `0o` up in a double, which is not the
// nearest one from 2^53 on. A BigInt is rounded once in both.
const toNumber = (text: string) =>
  /^0[box][0-9a-f]+$/i.test(text.trim()) && !Number.isNaN(Number(text)) ? Number(BigInt(text.trim())) : Number(text);
const naturalCompare = fromEslint("natural-compare");
const esutils = fromEslint("esutils");

const texts = new Set<string>([
  "", " ", "a", "A", "ab", "aB", "\u00E9", "\u00C9", "\u00DF", "\u01C6", "\u0130", "\u0131", "\u03A3", "\u0391\u03A3", "\u0391\u03A3 \u0392", "\u{1D4B3}", "a\u{1D4B3}b", "\u{1D4B3}\u{1D4B4}", "\u{10400}", "\uFEFFa\uFEFF", "\u0085a", "\u200Ba", "\u180Ea",
  "\u2028a\u2029", "\u00A0a\u3000", "\ta\n", "a\r\nb", "a\rb\nc\u2028d", "\r\n", "\\", "a\\1", "\\0", "\\01", "\\\\1", "\\8", "a-b", "a.b*c", "[a]{b}(c)|d^e$f?g+h", "\"", "\u0001\u001f\u007f",
  "1", "01", "1.", ".1", ".", "1e3", "1e", "1e+", "1E-2", "0x1F", "0X", "0b101", "0o17", "0b2", "+1", "-1", "+-1", "- 1", "Infinity", "-Infinity", "+Infinity", "infinity", "NaN", "1_000", "1n", " 12 ", "1 2",
  "1e400", "-0", "0.1", "123456789012345678901234567890", "5e-324", "0x1p3", "inf", "nan", "\u0661",
  "a1", "a2", "a10", "a01", "a1b", "a1b2", "a1b10", "1a", "10a", "2a", "a-1", "a_1", "a.1", "Z", "z", "_", "$", "-", "/", ":", "@", "[", "`", "{", "~", "a9", "a09", "a0", "a00", "x100y", "x99y",
  "yield", "let", "static", "await", "class", "enum", "null", "true", "if", "a b", "1a", "\u2102", "\uE000", "\uFFFD", "\u{1F600}", "\uE000a", "\u{1F600}a",
  // Half of a surrogate pair beside a whole one, each before what it is compared with.
  "\u{10000}", "\uDFFF", "\u{10FFFF}", "\uDBFF", "\uD800", "\uD800a", "\uD7FF", "\uD800\uE000", "a\uDC00", "a\u{10FFFF}",
  // Numbers that a double does not hold.
  "a19007199254740993", "a19007199254740992", "90071992547409930", "90071992547409921", "x90071992547409939007199254740993", "x90071992547409929007199254740992",
  // Digits of 1, 3 and 4 bits that have to be rounded once, at the end.
  "0o3450214447355555064307507", "0b011100100101010010011101001011011010010011100101101010101000", "0xd6B1EDe45fFAB43c3967Cd6E16", "0x20000000000001", "0x20000000000003",
  "0x" + "f".repeat(300), "0b1" + "0".repeat(52) + "1" + "0".repeat(90) + "1", "0b1" + "0".repeat(52) + "1" + "0".repeat(91),
]);
for (const line of readFileSync(process.argv[2], "utf8").split("\n").slice(0, 60000)) {
  if (!line) continue;
  const code: string = JSON.parse(line).code;
  if (code.length < 60 && code.isWellFormed()) texts.add(code);
}
const lineBreak = new RegExp(`\\r\\n|[\\r\\n${String.fromCharCode(0x2028, 0x2029)}]`, "u");
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const all = [...texts];
const order = (n: number) => (n < 0 ? "Less" : n > 0 ? "Greater" : "Equal");
const pairs: string[] = [];
const expected: string[] = [];
all.forEach((a, i) => {
  for (const b of [all[(i * 7 + 3) % 190], all[(i + 1) % all.length]]) {
    pairs.push(JSON.stringify([a, b]));
    expected.push(
      JSON.stringify([
        String(a.length),
        String([...a].length),
        a.trim(),
        a.trimStart(),
        a.trimEnd(),
        a.toLowerCase(),
        a.toUpperCase(),
        a === "" ? "" : a[0].toUpperCase() + a.slice(1),
        a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        escapeStringRegexp(a),
        String(toNumber(a)),
        JSON.stringify(a),
        String(a.split(lineBreak).length),
        a.slice(1, 3).isWellFormed() ? a.slice(1, 3) : null,
        `${esutils.keyword.isIdentifierES5(a)} ${esutils.keyword.isIdentifierES6(a)}`,
        `${order(a < b ? -1 : a > b ? 1 : 0)} ${order(naturalCompare(a, b))}`,
        /^[\x00-\x7f]*$/.test(a + b) ? `${order(a.localeCompare(b))} ${order(collator.compare(a, b))}` : null,
        `${astUtils.hasOctalOrNonOctalDecimalEscapeSequence(a)} ${a !== "" && [...a][0] !== [...a][0].toLocaleLowerCase()}`,
      ]),
    );
  }
});
writeFileSync(process.argv[3], pairs.join("\n") + "\n");
writeFileSync(process.argv[4], expected.join("\n") + "\n");

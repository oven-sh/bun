// Compares the small helpers of `bun_lint::utils` with ESLint's own modules and with `Intl.Segmenter`, on generated input.
//   bun compare.ts <bun-lint> <checkout of eslint> [GraphemeBreakTest.txt]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [binary, eslint, graphemeBreakTest] = process.argv.slice(2);
const lib = (path: string) => require(join(eslint, "lib", path));
const { upperCaseFirst, getGraphemeCount } = lib("shared/string-utils");
const { LETTER_PATTERN, containsLetter } = lib("rules/utils/string-utils");
const { parseStringLiteral, parseTemplateToken } = lib("rules/utils/char-source");
const naming = lib("shared/naming");
const { directivesPattern } = lib("shared/directives");
const { createGlobalLinebreakMatcher, shebangPattern } = lib("shared/ast-utils");
const keywords: string[] = lib("rules/utils/keywords");
const unicode = lib("rules/utils/unicode");

let seed = 0x2545f491;
function random(below: number): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % below;
}
const pick = <T>(from: readonly T[]): T => from[random(from.length)];
const sequence = (from: readonly string[], max: number) => Array.from({ length: random(max + 1) }, () => pick(from)).join("");

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
/** The offset in bytes of the UTF-16 index `index` of `text`. */
const offset = (text: string, index: number) => bytes(text.slice(0, index));

const cases: { line: string; expected: string; shown: string }[] = [];
function add(name: string, args: string[], expected: unknown) {
  cases.push({ line: [name, ...args.map(hex)].join("\t"), expected: String(expected), shown: `${name}(${args.map(it => JSON.stringify(it)).join(", ")})` });
}

// ── sets of code points ──
function members(is: (c: number) => boolean): string {
  let out = "";
  let start = -1;
  for (let c = 0; c <= 0x110000; c++) {
    const has = c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) && is(c);
    if (has && start < 0) start = c;
    else if (!has && start >= 0) (out += `${start.toString(16)}-${(c - 1).toString(16)} `), (start = -1);
  }
  return out;
}
add("isCombiningCharacter", [], members(unicode.isCombiningCharacter));
add("isEmojiModifier", [], members(unicode.isEmojiModifier));
add("isRegionalIndicatorSymbol", [], members(unicode.isRegionalIndicatorSymbol));
add("isLetter", [], members(c => containsLetter(String.fromCodePoint(c))));

// ── keywords ──
add("allKeywords", [], keywords.join(" "));
for (const word of [...keywords, ...keywords.map(it => it + "s"), ...keywords.map(it => it.slice(0, -1)), "", "a", "zzz", "let", "yield", "await", "é"]) add("keywords", [word], keywords.includes(word));

// ── graphemes ──
const segmenter = new Intl.Segmenter("en-US");
function grapheme(text: string) {
  add("graphemes", [text], [...segmenter.segment(text)].map(it => bytes(it.segment)).join(" "));
  add("getGraphemeCount", [text], getGraphemeCount(text));
}
// Some of each class, and what is next to the edges of the tables.
const INTERESTING = [
  "a", "Z", " ", "\r", "\n", "\t", "\0", "\x7f", "\x80", "\xa0", "\xa9", "\xad", "\xae", "é", "̀", "́", "̈", "͏", "҃", "҈",
  "؀", "؅", "۝", "܏", "࢐", "࣢", "ः", "ऻ", "़", "ा", "ी", "्", "क", "त", "र", "ष", "क़",
  "ক", "্", "়", "া", "ક", "્", "କ", "୍", "క", "్", "ക", "്", "ൎ", "்", "க", "್", "ಕ", "්", "ක",
  "ก", "ั", "ำ", "เ", "ຳ", "༾", "က", "္", "်", "ါ", "ᄀ", "ᅟ", "ᅠ", "ᅡ", "ᆧ", "ᆨ", "ᇿ", "ꥠ", "ힰ", "ퟋ",
  "가", "각", "갛", "개", "힣", "ក", "្", "᩠", "᭄", "᮪", "᮫", "꠆", "꣄", "꧀", "꫶", "꯭",
  "᠎", "​", "‌", "‍", "‎", " ", " ", "⁠", "⃣", "⃝", "‼", "⁉", "™", "ℹ", "↔", "⌚", "⌨", "☀", "♀", "♂", "❤", "⭐", "〰", "〽", "㊗",
  "〪", "゙", "︎", "️", "﻿", "ﾞ", "ﾟ", "￹", "�", "中", "あ",
  "\u{1f1e6}", "\u{1f1e7}", "\u{1f1ff}", "\u{1f1e5}", "\u{1f200}", "\u{1f3fb}", "\u{1f3ff}", "\u{1f466}", "\u{1f468}", "\u{1f469}", "\u{1f600}", "\u{1f308}", "\u{1f3f3}", "\u{1f3f4}", "\u{1f9d1}", "\u{1f91d}", "\u{1faf1}", "\u{1f000}", "\u{1f0ff}", "\u{1fffd}", "\u{1f100}",
  "\u{e0001}", "\u{e0020}", "\u{e0062}", "\u{e007f}", "\u{e0100}", "\u{e01ef}", "\u{e0fff}", "\u{110bd}", "\u{110cd}", "\u{11046}", "\u{11013}", "\u{1107f}", "\u{111c2}", "\u{11133}", "\u{11103}", "\u{1193f}", "\u{11941}", "\u{11a3a}", "\u{11a84}", "\u{11d46}", "\u{11f02}", "\u{11f42}", "\u{11f12}",
  "\u{1d165}", "\u{1d16d}", "\u{16fe4}", "\u{16ff0}", "\u{13430}", "\u{13440}", "\u{10a3f}", "\u{10a00}", "\u{1e94a}", "\u{10ffff}", "\u{1f1e6}\u{1f1e7}", "\u{1f468}‍\u{1f469}‍\u{1f467}", "क्ष", "\r\n",
];
for (const a of INTERESTING) for (const b of INTERESTING) grapheme(a + b);
for (let i = 0; i < 60000; i++) grapheme(sequence(INTERESTING, 10));
// Every code point, before and after what it can combine with.
{
  const around = ["a", "̀", "‍", "\u{1f600}", "ᄀ", "ᅡ", "ᆨ", "\u{1f1e6}", "क", "्", "ः", "؀"];
  for (let base = 0; base <= 0x10ffff; base += 0x400) {
    let text = "";
    for (let c = base; c < base + 0x400; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const s = String.fromCodePoint(c);
      text += pick(around) + s + pick(around) + s + pick(around) + pick(around) + "\n";
    }
    if (text) grapheme(text);
  }
}
for (let i = 0; i < 20000; i++) grapheme(Array.from({ length: 1 + random(8) }, () => { const c = random(4) ? random(0x3000) : random(0x110000); return c >= 0xd800 && c <= 0xdfff ? "x" : String.fromCodePoint(c); }).join(""));
for (const text of ["", "a", "abc", "\r\n", "a\r\nb", "é\r\n", "\r\né", "\n\r"]) grapheme(text);
if (graphemeBreakTest) {
  for (const line of readFileSync(graphemeBreakTest, "utf8").split("\n")) {
    const rule = line.split("#")[0].trim();
    if (!rule) continue;
    const clusters = rule.split("÷").map(it => it.trim()).filter(Boolean).map(it => it.split("×").map(c => String.fromCodePoint(parseInt(c.trim(), 16))).join(""));
    if (/[\ud800-\udfff]/.test(clusters.join("").replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))) continue;
    add("graphemes", [clusters.join("")], clusters.map(bytes).join(" "));
  }
}

// ── letters, case, lines ──
const TEXT = ["a", "Z", "1", " ", "-", "_", "é", "ß", "ŉ", "ǆ", "ﬁ", "ı", "İ", "σ", "ς", "я", "中", "٣", "̀", "ª", "ʰ", "ⅷ", "\u{10400}", "\u{10428}", "\u{1d49c}", "\u{1f600}", " ", " ", "\r", "\n", "\r\n", "#", "!", "/", "ŉ", "ẞ", "ΰ"];
for (let i = 0; i < 20000; i++) {
  const text = sequence(TEXT, 6);
  add("upperCaseFirst", [text], hex(upperCaseFirst(text)));
  add("containsLetter", [text], containsLetter(text));
  const match = text.match(LETTER_PATTERN);
  add("LETTER_PATTERN", [text], match ? `${offset(text, match.index!)}:${offset(text, match.index! + match[0].length)}` : "");
  add("createGlobalLinebreakMatcher", [text], [...text.matchAll(createGlobalLinebreakMatcher())].map(it => `${offset(text, it.index)}:${offset(text, it.index + it[0].length)}`).join(" "));
  const shebang = (random(2) ? "#!" : "") + text;
  const found = shebangPattern.exec(shebang);
  add("shebangPattern", [shebang], found ? hex(found[1]) : "null");
}

// ── naming ──
const NAME = ["@", "/", "\\", "-", "eslint-plugin", "eslint-config", "eslint", "plugin", "foo", "bar", "a", "é", "\n", " ", "."];
for (let i = 0; i < 60000; i++) {
  const name = (random(2) ? "@" : "") + sequence(NAME, 6);
  const prefix = pick(["eslint-plugin", "eslint-config", "eslint-formatter"]);
  add("normalizePackageName", [name, prefix], hex(naming.normalizePackageName(name, prefix)));
  add("getShorthandName", [name, prefix], hex(naming.getShorthandName(name, prefix)));
  add("getNamespaceFromTerm", [name], hex(naming.getNamespaceFromTerm(name)));
}

// ── directives ──
const DIRECTIVE = ["eslint", "-env", "-enable", "-disable", "-next", "-line", "exported", "global", "globals", "s", " ", "\t", "\n", " ", " ", "﻿", "​", "x", "-", "é"];
for (let i = 0; i < 40000; i++) {
  const text = sequence(DIRECTIVE, 6);
  add("directivesPattern", [text], directivesPattern.exec(text)?.[1] ?? "null");
}

// ── the source of code units ──
const PIECES = [
  "a", "b", "0", "7", "8", "9", "x", "u", "{", "}", "$", "${", "'", '"', "`", " ", "é", "中", "\u{1f600}", "\u{10000}", " ", " ", "﻿",
  "\\n", "\\r", "\\t", "\\b", "\\f", "\\v", "\\0", "\\00", "\\000", "\\1", "\\12", "\\123", "\\377", "\\400", "\\4", "\\47", "\\477", "\\7", "\\8", "\\9", "\\08", "\\x41", "\\xe9", "\\xFF", "\\u0041", "\\u00e9", "\\uD83D", "\\uDE00", "\\uD83D\\uDE00",
  "\\u{41}", "\\u{0000041}", "\\u{1F600}", "\\u{10FFFF}", "\\u{ffff}", "\\u{10000}", "\\\\", "\\'", '\\"', "\\`", "\\$", "\\{", "\\a", "\\é", "\\中", "\\\u{1f600}", "\\\n", "\\\r", "\\\r\n", "\\ ", "\\ ", "\n", "\r", "\r\n",
];
type CodeUnit = { start: number; end: number };
function unitsOf(source: string, value: string, parsed: CodeUnit[]): string {
  const isLead = (index: number) => /[\ud800-\udbff]/.test(source[index] ?? "") && /[\udc00-\udfff]/.test(source[index + 1] ?? "");
  const out: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    let { start, end } = parsed[i];
    // One character of the source that gives two code units: both have its range.
    if (isLead(end - 1)) end = parsed[i + 1].end;
    else if (i > 0 && isLead(parsed[i - 1].end - 1)) start = parsed[i - 1].start;
    out.push(`${value.charCodeAt(i).toString(16)}:${offset(source, start)}:${offset(source, end)}`);
  }
  return out.join(" ");
}
let literals = 0;
for (let i = 0; i < 400000; i++) {
  const body = sequence(PIECES, 8);
  for (const [open, close, name, parse] of [["'", "'", "parseStringLiteral", parseStringLiteral], ['"', '"', "parseStringLiteral", parseStringLiteral], ["`", "`", "parseTemplateToken", parseTemplateToken], ["`", "${", "parseTemplateToken", parseTemplateToken], ["}", "`", "parseTemplateToken", parseTemplateToken]] as const) {
    if (random(5)) continue;
    const source = open + body + close;
    let value: string;
    try {
      // Only what is a single literal or token.
      if (name === "parseStringLiteral") {
        const all = (0, eval)(`[${source}]`);
        if (all.length !== 1) continue;
        value = all[0];
      } else {
        const code = open === "}" ? "`${0" + source : close === "${" ? source + "0}`" : source;
        const cooked = (0, eval)(`(s => s)${code}`);
        if (cooked.length !== (open === "`" && close === "`" ? 1 : 2)) continue;
        value = cooked[open === "}" ? 1 : 0];
      }
      if (typeof value !== "string") continue;
    } catch {
      continue;
    }
    const parsed: CodeUnit[] = parse(source);
    if (parsed.length !== value.length) throw new Error(`upstream disagrees with eval on ${JSON.stringify(source)}`);
    add(name, [source], unitsOf(source, value, parsed));
    literals++;
  }
}

const directory = mkdtempSync(join(tmpdir(), "utils-small-"));
const input = join(directory, "input.txt");
writeFileSync(input, cases.map(it => it.line).join("\n") + "\n");
const { stdout, status } = spawnSync(binary, ["utils-small", input], { encoding: "utf8", maxBuffer: 1 << 30 });
rmSync(directory, { recursive: true, force: true });
const actual = stdout.split("\n");
const failed: Record<string, number> = {};
const total: Record<string, number> = {};
let shown = 0;
cases.forEach((it, i) => {
  const name = it.line.split("\t")[0];
  total[name] = (total[name] ?? 0) + 1;
  if (actual[i] === it.expected) return;
  failed[name] = (failed[name] ?? 0) + 1;
  if (failed[name] <= 5 && shown++ < 60) console.log(`${it.shown.slice(0, 300)}\n  expected ${it.expected.slice(0, 300)}\n  actual   ${String(actual[i]).slice(0, 300)}`);
});
for (const name in total) console.log(`${name}: ${total[name] - (failed[name] ?? 0)}/${total[name]}`);
process.exit(status === 0 && Object.keys(failed).length === 0 ? 0 : 1);

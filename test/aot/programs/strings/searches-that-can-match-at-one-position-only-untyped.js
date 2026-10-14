// Searches that can match at one position only: `s.lastIndexOf(x, 0)` and `s.indexOf(x, s.length - x.length)`, the idioms from before `startsWith` and `endsWith` (the same program without type annotations).
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
const makers = [
  () => "The quick brown fox",
  () => "",
  () => "x",
  () => ".",
  () => ".ts",
  () => "a.ts",
  () => "caf\xE9 \xDF\xFF\xB5 au lait",
  () => "\u65E5\u672C\u8A9E\u306E text",
  () => "a\uD83D\uDE00b\uD83D",
  () => cat("The quick ", "brown fox"),
  () => cat("abc", "\u65E5\u672C"),
  () => cat3("one", " two ", "three"),
  () => flattened(cat("The quick ", "brown fox")),
  () => part("xxThe quick brown foxxx", 2, 21),
  () => part("xx\u65E5\u672C\u8A9E\u306E textxx", 2, 11),
  () => part(part("xxThe quick brown foxxx", 2, 21), 4, 15),
  () => part(cat("xxThe quick ", "brown foxxx"), 2, 21),
  () => cat("a".repeat(200), "b".repeat(200) + "z" + "c".repeat(10)),
  () => cat("\u65E5".repeat(200), "b".repeat(200) + "z"),
  () => "/usr/lib/node_modules/typescript/lib/lib.es2015.core.d.ts",
  () => cat("/usr/lib/", "lib.d.ts"),
  () => flattened(cat("\u65E5", "/src/index.ts")).slice(1),
  () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
  () => "abcdefgh",
  () => "abcdefghi",
  () => "abcdefg"
];
const needles = [
  () => "",
  () => "x",
  () => ".",
  () => "T",
  () => "fox",
  () => "The",
  () => "The ",
  () => "quick",
  () => " ",
  () => "brown fox",
  () => "The quick brown fox",
  () => "The quick brown fox!",
  () => "\xE9",
  () => "caf\xE9",
  () => "lait",
  () => "\u65E5",
  () => "\u65E5\u672C",
  () => "text",
  () => "\uD83D",
  () => "a\uD83D",
  () => "z",
  () => "ccc",
  () => ".ts",
  () => ".d.ts",
  () => "d.ts",
  () => "/usr",
  () => "/",
  () => cat("f", "ox"),
  () => cat("Th", "e"),
  () => part("xfoxx", 1, 4),
  () => part("x\u65E5x", 1, 2),
  () => "abcdefgh",
  () => "abcdefg",
  () => "bcdefgh",
  () => "abcdefghi",
  () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
  () => "aaaaaaaaaaaaaaaaab",
  () => "one two three",
  () => " three",
  () => "one "
];
export function oldStartsWith(s, x) {
  return s.lastIndexOf(x, 0) === 0;
}
export function oldStartsWithDot(s) {
  return s.lastIndexOf(".", 0) === 0;
}
export function oldStartsWithText(s) {
  return s.lastIndexOf("The quick", 0);
}
export function lastIndexOfAtZero(s, x) {
  return s.lastIndexOf(x, 0);
}
export function lastIndexOfBelowZero(s, x) {
  return s.lastIndexOf(x, -3);
}
export function lastIndexOfOne(s, x) {
  return s.lastIndexOf(x, 1);
}
export function lastIndexOfAnywhere(s, x, p) {
  return s.lastIndexOf(x, p | 0);
}
export function oldEndsWith(s, x) {
  const expected = s.length - x.length;
  return expected >= 0 && s.indexOf(x, expected) === expected;
}
export function indexOfFrom(s, x, p) {
  return s.indexOf(x, p);
}
export function includesFrom(s, x, p) {
  return s.includes(x, p);
}
export function indexOfTextFrom(s, p) {
  return s.indexOf(".ts", p);
}
export function indexOfDotFrom(s, p) {
  return s.indexOf(".", p);
}
for (let i = 0;i < makers.length; i++) {
  let line = show(makers[i]()).slice(0, 24) + ":";
  for (let j = 0;j < needles.length; j++) {
    const length = makers[i]().length, other = needles[j]().length;
    line += " " + (oldStartsWith(makers[i](), needles[j]()) ? 1 : 0) + lastIndexOfAtZero(makers[i](), needles[j]()) + lastIndexOfBelowZero(makers[i](), needles[j]()) + lastIndexOfOne(makers[i](), needles[j]()) + (oldEndsWith(makers[i](), needles[j]()) ? 1 : 0);
    if (oldStartsWith(makers[i](), needles[j]()) !== makers[i]().startsWith(needles[j]()) || oldEndsWith(makers[i](), needles[j]()) !== makers[i]().endsWith(needles[j]()))
      line += "DIFFERS";
    for (const p of [length - other - 2, length - other - 1, length - other, length - other + 1, length - other + 2, length - 1, length, length + 1, 0, -1, 0.5, length - other + 0.5, NaN, 1 / 0, -1 / 0, 2147483648, 4294967297, -2147483648])
      line += "," + indexOfFrom(makers[i](), needles[j](), p) + (includesFrom(makers[i](), needles[j](), p) ? "t" : "f");
    for (const p of [0, -1, 1, -2147483648, 2147483647, length - other, length])
      line += ";" + lastIndexOfAnywhere(makers[i](), needles[j](), p);
  }
  let sum = 0;
  for (let k = 0;k < line.length; k++)
    sum = sum * 31 + line.charCodeAt(k) | 0;
  print(line.slice(0, 150) + " .. " + line.length + " " + sum);
  let known = "";
  for (const p of [makers[i]().length - 4, makers[i]().length - 3, makers[i]().length - 2, makers[i]().length - 1, makers[i]().length, 0, -5])
    known += " " + indexOfTextFrom(makers[i](), p) + "," + indexOfDotFrom(makers[i](), p);
  print("  " + oldStartsWithDot(makers[i]()) + " " + oldStartsWithText(makers[i]()) + known);
}
function nil() {
  return makers.length > 1000 ? "" : undefined;
}
print(attempt(() => oldStartsWith(nil(), "x")) + " " + attempt(() => oldStartsWithDot(nil())) + " " + attempt(() => oldEndsWith(nil(), "x")) + " " + attempt(() => lastIndexOfAtZero("undefined", nil())) + " " + attempt(() => indexOfFrom("xundefined", nil(), 1)));
globalThis.kept = [oldStartsWith, oldStartsWithDot, oldStartsWithText, lastIndexOfBelowZero, lastIndexOfOne, lastIndexOfAnywhere, oldEndsWith];
console.log("number");

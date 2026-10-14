// `a.localeCompare(b)` with one string argument, with locales or options, and with other kinds of arguments (the same program without type annotations).
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
export function compared(a, b) {
  return a.localeCompare(`${b}`);
}
export function sorted(list) {
  return list.slice().sort((a, b) => `${a}`.localeCompare(`${b}`));
}
export function comparedIn(a, b, locale) {
  return a.localeCompare(b, locale);
}
export function comparedWith(a, b, options) {
  return a.localeCompare(b, undefined, options);
}
export function comparedWithAnything(a, b) {
  return a.localeCompare(b);
}
const words = ["", "a", "A", "b", "B", "aa", "ab", "a b", "a-b", "a_b", "Z", "z", "10", "9", "1", "\xE4", "\xC4", "ae", "\xE9", "e", "f", "\xDF", "ss", "\xF1", "n", "o", "\u65E5\u672C", "\u4E2D", "\uD83D\uDE00", "\u2500", " ", "\t", "~", "!", "\x7F", "\x00", "a\x00", "resume", "r\xE9sum\xE9", "Resume", "co-op", "coop", "e\u0301", cat("ro", "pe"), part("xxropexx", 2, 6), cat("\xE4", "b")];
for (const a of words)
  print(show(a) + ": " + words.map((b) => compared(a, b)).join(""));
print(sorted(words).map(show).join(" "));
print([typeof compared("a", "b"), Object.is(compared("a", "a"), 0), compared("a", "b") + compared("b", "a"), compared("a", "b") < 0, [compared("b", "a")].includes(1), 1 / compared("x", "x")].join());
print(["de", "sv", "en", "ja", "tr"].map((l) => comparedIn("\xE4", "z", l) + "" + comparedIn("i", "I", l) + comparedIn("a", "\xE4", l)).join() + " " + comparedWith("a", "A", { sensitivity: "base" }) + comparedWith("a", "\xE4", { sensitivity: "base" }) + comparedWith("10", "9", { numeric: true }) + comparedWith("a", "A", { caseFirst: "upper" }));
print([undefined, null, 1, "1", true, { toString() {
  return "b";
} }, ["a"], 1.5].map((b) => comparedWithAnything("b", b)).join() + " " + attempt(() => comparedWithAnything("a", Symbol.iterator)) + " " + attempt(() => comparedIn("a", "b", "not a locale")) + " " + attempt(() => compared(undefined, "a")) + " " + attempt(() => compared(null, "a")));
{
  let sum = 0;
  for (let i = 0;i < 3000; i++)
    sum += compared("item " + i * 7919 % 1000, "item " + i * 104729 % 1000) * (i & 7);
  print(String(sum));
}
globalThis.kept = [compared, sorted, comparedIn, comparedWith, comparedWithAnything];
console.log("number");

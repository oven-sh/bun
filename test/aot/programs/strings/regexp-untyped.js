// RegExp literals, and the string methods that take a RegExp or a string (the same program without type annotations).
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
export function literal() {
  return /a+(b)?/gi;
}
export function constants() {
  return new RegExp("a+(b)?", "gi");
}
export function fromSource(s) {
  return new RegExp(s, "g");
}
export function fromBoth(s, f) {
  return new RegExp(s, f);
}
export function vowels(s, re, by) {
  return s.replace(re, by);
}
function replaced(s, re, by) {
  return s.replace(re, by);
}
function cut(s, by) {
  return s.split(by);
}
function matched(s, by) {
  return s.match(by);
}
function searched(s, by) {
  return s.search(by);
}
export function shout(s, re, f) {
  return s.replace(re, f);
}
export function swap(s, a, b) {
  return s.replace(a, b);
}
export function words(s, re) {
  return s.split(re);
}
export function parts(s, by) {
  return s.split(by);
}
export function found(s, re) {
  return s.match(re);
}
export function where(s, re) {
  return s.search(re);
}
export function isGlobal(re) {
  return re.global;
}
export function flagsOf(re) {
  return re.flags;
}
export function sourceOf(re) {
  return re.source;
}
const list = (a) => a === null ? "null" : "[" + Array.from(a, (x) => x === undefined ? "undefined" : show(x)).join() + "]" + ("index" in a ? "@" + a.index + (a.groups ? JSON.stringify(a.groups) : "") : "");
const about = (re) => String(re) + " " + re.lastIndex + " " + [re.dotAll, re.global, re.hasIndices, re.ignoreCase, re.multiline, re.sticky, re.unicode, re.unicodeSets].map((b) => b ? 1 : 0).join("") + " " + flagsOf(re) + " " + show(sourceOf(re)) + " " + isGlobal(re);
{
  const a = literal(), b = literal();
  a.lastIndex = 3;
  a.mine = 1;
  print([a === b, b.lastIndex, b.mine, about(a), about(b), about(constants()), Object.getPrototypeOf(a) === RegExp.prototype, a instanceof RegExp, Object.getOwnPropertyNames(a).join()].map(show).join());
}
function sticky(s) {
  const re = /a/y;
  const first = re.test(s);
  return first + ":" + re.lastIndex + ":" + re.test(s) + ":" + re.lastIndex;
}
function counting(s) {
  let n = 0;
  for (let i = 0;i < 3; i++) {
    const re = /a/g;
    while (re.exec(s))
      n++;
  }
  return n;
}
print(sticky("aab") + " " + sticky("ba") + " " + counting("banana"));
print([/(?:)/, /\//, /[/]/, /\n/, /\u{1f600}/u, /[\p{L}--[a-z]]/v, /(?<year>\d{4})-(?<month>\d\d)/d, /\u65e5\u672c|\u00e9/, /^$/m, /./s, / /, /a|b|c/i].map(about).join(" | "));
print([new RegExp("/"), new RegExp(`
`), new RegExp(""), new RegExp("a", ""), new RegExp("\\d+", "y"), RegExp("x", "gimsuy"), RegExp("x"), new RegExp("\u65E5", "u"), fromSource("a.c"), fromSource(cat("a", "+")), fromSource(""), fromBoth("a", "gi"), fromBoth("a", "")].map(about).join(" | "));
print([() => new RegExp("(", "g"), () => new RegExp("a", "gg"), () => new RegExp("a", "x"), () => new RegExp("a", "uv"), () => new RegExp("\\", ""), () => RegExp("[", ""), () => fromSource("("), () => fromSource("a{2,1}"), () => fromBoth("a", "q"), () => fromBoth("(?<a>.)(?<a>.)", ""), () => new RegExp("\\p{Foo}", "u")].map((f) => attempt(() => about(f()))).join(" | "));
for (let round = 0;round < 3; round++)
  print(attempt(() => about(new RegExp("(", "g"))) + " " + about(/ok/g));
const subjects = ["", "a", "education", `The quick  brown	fox
jumps`, "aaa", "a-b_c d", "2026-10-08 and 1999-12-31", "\u65E5\u672C\u8A9E caf\xE9", cat("ro", "pe and rope"), part("xx substring of a longer one xx", 3, 20), "$1 $& $$", "x".repeat(50) + "y"];
const expressions = [() => /[aeiou]/, () => /[aeiou]/g, () => /\s+/, () => /\s+/g, () => /(\w)(\w)?/g, () => /(?<year>\d{4})-(?<month>\d\d)/, () => /(?<year>\d{4})-(?<month>\d\d)/g, () => /a/y, () => /a/gy, () => /(?:)/, () => /(?:)/g, () => /^/gm, () => /$/, () => /\u672c|\u00e9/g, () => /./gu, () => /(a)|(b)/g, () => /x*y/, () => /nomatch/g, () => /(\d+)/d];
for (const s of subjects)
  for (const make of expressions) {
    const used = make();
    print(show(s) + " " + String(used) + ": " + [vowels(s, make(), "_"), vowels(s, make(), ""), vowels(s, make(), "[$&|$1|$2|$`|$'|$$|$<year>|$0|$3]"), shout(s, make(), (m, ...rest) => "<" + m.toUpperCase() + rest.length + ">"), list(words(s, make())), list(s.split(make(), 2)), list(s.split(make(), 0)), list(found(s, make())), where(s, make())].map(show).join(" ") + " " + (vowels(s, used, "_"), used.lastIndex) + (found(s, used), used.lastIndex) + (where(s, used), used.lastIndex) + (words(s, used), used.lastIndex));
  }
for (const s of subjects)
  for (const a of ["", "a", " ", "o", "ro", "$", "\u672C", "xx", "nomatch", s])
    print(show(s) + " " + show(a) + ": " + [swap(s, a, "_"), swap(s, a, ""), swap(s, a, "[$&|$`|$'|$$|$1]"), swap(s, a, cat("r", "ope")), list(parts(s, a)), list(s.split(a, 2)), list(s.split(a, 0)), list(s.split(a, 4294967295)), s.replaceAll(a, "+")].map(show).join(" "));
{
  const re = /a/g;
  re.lastIndex = 2;
  print([vowels("aaaa", re, "b"), re.lastIndex].join());
  re.lastIndex = 2;
  print([list(found("aaaa", re)), re.lastIndex].join());
  re.lastIndex = 2;
  print([where("baaa", re), re.lastIndex].join());
  const y = /a/y;
  y.lastIndex = 1;
  print([vowels("aaaa", y, "b"), y.lastIndex, list(found("baaa", y)), y.lastIndex, where("baaa", y), y.lastIndex].join());
}
{
  const frozen = Object.freeze(/a/g);
  print([() => vowels("aaa", frozen, "b"), () => list(found("aaa", frozen)), () => where("baa", frozen), () => list(words("bab", frozen))].map(attempt).join(" "));
}
{
  const odd = /a/g;
  odd.lastIndex = { valueOf() {
    print("valueOf of lastIndex");
    return 1;
  } };
  print([() => vowels("aaa", odd, "b"), () => list(found("aaa", odd))].map(attempt).join(" "));
}
{
  const own = /a/g;
  own.exec = function() {
    print("own exec");
    return null;
  };
  print([() => vowels("aaa", own, "b"), () => list(found("aaa", own)), () => where("aaa", own), () => list(words("bab", own)), () => own.test("a")].map(attempt).join(" "));
}
{
  const own = /a/g;
  Object.defineProperty(own, Symbol.replace, { value: () => "own replace" });
  Object.defineProperty(own, Symbol.split, { value: () => ["own split"] });
  Object.defineProperty(own, Symbol.match, { value: () => ["own match"] });
  Object.defineProperty(own, Symbol.search, { value: () => -7 });
  print([vowels("aaa", own, "b"), list(words("aaa", own)), list(found("aaa", own)), where("aaa", own)].join(" "));
}
{
  const own = /a/g;
  Object.defineProperty(own, "flags", { value: "" });
  Object.defineProperty(own, "global", { value: false });
  print([vowels("aaa", own, "b"), flagsOf(own), isGlobal(own), list(found("aaa", own))].join(" "));
}
{
  const own = /a/;
  Object.defineProperty(own, "flags", { value: "g" });
  Object.defineProperty(own, "global", { value: true });
  print([flagsOf(own), isGlobal(own)].join(" "));
}

class Sub extends RegExp {
  exec(s) {
    const m = super.exec(s);
    if (m)
      m[0] = m[0].toUpperCase();
    return m;
  }
  get global() {
    return false;
  }
}
{
  const sub = new Sub("a", "g");
  print([vowels("aaa", sub, "[$&]"), list(found("aaa", sub)), where("baa", sub), list(words("bab", sub)), isGlobal(sub), flagsOf(sub), sourceOf(sub)].join(" "));
}
{
  const re = /a/g;
  re.compile("b", "i");
  print(about(re) + " " + vowels("abAB", re, "_"));
}
print([() => shout("abc", /b/, () => {
  throw new RangeError("mine");
}), () => shout("abc", /b/g, () => 5), () => shout("abc", /b/, () => ({ toString() {
  return "obj";
} })), () => replaced("abc", /b/, 5), () => vowels("abc", /b/, undefined), () => replaced("abc", /b/, { toString() {
  return "[$&]";
} }), () => vowels("abc", null, "x"), () => vowels("a null b", null, "x"), () => list(cut("a1b", 1)), () => list(matched("a1b", "1")), () => searched("a1b", "1"), () => list(found("abc", undefined)), () => list(words("abc", undefined))].map(attempt).join(" | "));
print([RegExp.$1, RegExp.lastMatch, RegExp["$`"]].map(show).join() + " " + (vowels("xaby", /a(b)/, "_"), [RegExp.$1, RegExp.lastMatch, RegExp["$`"]].map(show).join()) + " " + (found("xcdy", /c(d)/), [RegExp.$1, RegExp.lastMatch].map(show).join()) + " " + (where("xefy", /e(f)/), [RegExp.$1, RegExp.lastMatch].map(show).join()) + " " + (words("xghy", /g(h)/), [RegExp.$1, RegExp.lastMatch].map(show).join()));
let sum = 0;
for (let i = 0;i < 20000; i++) {
  const s = "item " + i + ", value " + i * 7;
  sum = (sum + s.replace(/\d+/g, "#").length + s.split(/,\s*/).length + /value (\d+)/.exec(s)[1].length + (/9/.test(s) ? 1 : 0) + s.search(/v/) + s.match(/\d/g).length) % 1000003;
}
print(String(sum));
globalThis.kept = [literal, constants, fromSource, fromBoth, vowels, shout, swap, words, parts, found, where, isGlobal, flagsOf, sourceOf];
console.log("number");

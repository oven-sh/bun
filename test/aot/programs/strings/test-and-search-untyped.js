// `RegExp.prototype.test` and `String.prototype.search`: `lastIndex` of every kind, the legacy static properties, ropes, 16-bit strings and errors (the same program without type annotations).
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
const log = [];
export function tested(r, s) {
  return r.test(s);
}
export function testedUntyped(r, s) {
  return r.test(s);
}
export function searched2(s, r) {
  return s.search(r);
}
export function searchedUntyped(s, r) {
  return s.search(r);
}
const statics = () => [RegExp.$1, RegExp.$2, RegExp.lastMatch, RegExp.lastParen, RegExp["$`"], RegExp["$'"], RegExp.input].map(show).join();
print(tested(/b(c)(d)?/, "abcde") + " " + statics());
print(tested(/zz/, "abcde") + " " + statics());
print(searched2("xxhello", /h(e)l/) + " " + statics());
print(searched2("xx", /h(e)l/) + " " + statics());
print(testedUntyped(/(\d+)-(\d+)/, "on 12-34.") + " " + statics() + " " + searchedUntyped("on 56-78.", /(\d+)-(\d+)/) + " " + statics());
for (const flags of ["", "i", "m", "s", "u", "v", "d", "g", "y", "gy", "gi"]) {
  let out = flags + ":";
  for (const index of [0, 1, 2, 5, 99, -1, 1.5, -0, NaN, 1 / 0, 4294967295, 4294967296, "1", "x", null, undefined, true, { valueOf() {
    log.push("valueOf");
    return 1;
  } }, { toString() {
    log.push("toString");
    return "2";
  } }]) {
    const r = new RegExp("b", flags);
    r.lastIndex = index;
    out += " " + tested(r, "abcb") + "/" + (typeof r.lastIndex === "object" ? "o" : String(r.lastIndex));
    r.lastIndex = index;
    out += "," + searched2("abcb", r) + "/" + (typeof r.lastIndex === "object" ? "o" : String(r.lastIndex));
  }
  print(out + " " + log.splice(0).length);
}
print(attempt(() => {
  const r = /b/;
  r.lastIndex = { valueOf() {
    throw new RangeError("mine");
  } };
  return tested(r, "abc");
}) + " " + attempt(() => {
  const r = /b/;
  r.lastIndex = Symbol.iterator;
  return tested(r, "abc");
}) + " " + attempt(() => {
  const r = /b/;
  r.lastIndex = 1n;
  return tested(r, "abc");
}));
{
  const frozen = Object.freeze(/b/);
  const frozenGlobal = Object.freeze(/b/g);
  print(tested(frozen, "abc") + " " + searched2("abc", frozen) + " " + attempt(() => tested(frozenGlobal, "abc")) + " " + attempt(() => searched2("abc", frozenGlobal)));
}
{
  const left = "left of the rope ", right = "and its right " + String(Date.length);
  const rope = "left of the rope " + right;
  print(tested(/rope and/, rope) + " " + searched2("left of the rope " + right + "left of the rope ", /right 7left/) + " " + tested(/^$/, "") + " " + tested(/abc/, "ab") + " " + searched2("", /x?/) + " " + tested(/\u65E5\u672C/, "in \u65E5\u672C\u8A9E") + " " + searched2("caf\xE9 \uD83D\uDE00!", /\p{Emoji_Presentation}/u) + " " + searched2("a\uD83D\uDE00", /\ude00/) + " " + searched2("a\uD83D\uDE00", /\ude00/u) + " " + tested(/x$/, "y".repeat(5000) + "x") + " " + searched2("abcdef".slice(2), /e/));
}
{

  class Mine extends RegExp {
    exec(s) {
      log.push("exec of mine");
      return super.exec(s);
    }
  }
  print(testedUntyped(new Mine("b"), "abc") + " " + searchedUntyped("abc", new Mine("c")) + " " + log.splice(0).join());
  const own = /b/;
  own.exec = () => {
    log.push("own exec");
    return null;
  };
  print(testedUntyped(own, "abc") + " " + searchedUntyped("abc", own) + " " + log.splice(0).join());
  print(testedUntyped({ test: () => "no RegExp" }, "") + " " + attempt(() => RegExp.prototype.test.call({}, "a")) + " " + attempt(() => testedUntyped(/a/, Symbol.iterator)) + " " + testedUntyped(/null/, null) + testedUntyped(/undefined/, undefined) + testedUntyped(/12/, 3127) + " " + searchedUntyped("a1b", 1) + searchedUntyped("a.b", ".") + searchedUntyped("abc", undefined) + " " + searchedUntyped("abc", { [Symbol.search]: () => "mine" }));
}
{
  const r = /a/;
  r.compile("c");
  print(tested(r, "abc") + " " + searched2("abc", r) + " " + attempt(() => tested(new RegExp("("), "a")));
}
{
  const many = new RegExp("(a)".repeat(20) + "(b)?");
  print(tested(many, "a".repeat(20)) + " " + statics() + " " + searched2("x" + "a".repeat(20), many) + " " + tested(/^(a+)+$/, "a".repeat(18) + "b") + " " + tested(/(?<year>\d{4})-(?<month>\d\d)/, "2026-10") + show(RegExp.$2) + " " + tested(/(?<=\$)\d+/, "cost $42") + show(RegExp.lastMatch) + " " + tested(/\bfoo\b/i, "a FOO b") + " " + tested(/^(?:one|two|three)$/, "two") + tested(/^(?:one|two|three)$/, "twos"));
}
{
  let n = 0;
  const printable = /^[ -~]*$/;
  for (let i = 0;i < 20000; i++) {
    if (tested(printable, "line " + i + (i % 7 ? "" : "\u2500")))
      n++;
    n += searched2("line " + i, /\d$/);
  }
  print(String(n) + " " + statics());
}
globalThis.kept = [tested, testedUntyped, searched2, searchedUntyped];
console.log("number");

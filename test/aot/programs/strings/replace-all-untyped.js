// `replaceAll()` with (string, string), with (RegExp, anything), with other arguments, and with a RegExp that is not global (the same program without type annotations).
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
export function texts(s, a, b) {
  return s.replaceAll(`${a}`, `${b}`);
}
export function byRegExp(s, r, b) {
  return s.replaceAll(r, `${b}`);
}
export function byRegExpAndFunction(s, r, f) {
  return s.replaceAll(r, f);
}
export function byFunction(s, a, f) {
  return s.replaceAll(a, f);
}
export function byAnything(s, a, b) {
  return s.replaceAll(a, b);
}
const box = "\u2500";
for (const [s, a, b] of [
  ["a;b;c", ";", `;
`],
  ["", "", "x"],
  ["abc", "", "-"],
  ["aaa", "a", "aa"],
  ["aaaa", "aa", "b"],
  ["abc", "x", "y"],
  ["abc", "abc", ""],
  ["a.b.c", ".", "$&$&"],
  ["a.b", ".", "$$"],
  ["a.b", ".", "[$`|$']"],
  ["a.b", ".", "$1$<n>"],
  ["x" + box + "y" + box, box, "-"],
  ["x-y-", "-", box],
  [cat("ro;", "pe;"), ";", "!"],
  [part("xx;a;b;xx", 2, 7), ";", cat("<", ">")],
  ["a".repeat(300) + ";" + "b".repeat(300) + ";", ";", `
`],
  ["\uD83D\uDE00", "\uDE00", "x"]
])
  print(show(texts(s, a, b)));
print(String(texts("same", "x", "y") === "same") + " " + show(byRegExp("a1b22c333", /\d+/g, "<$&>")) + " " + show(byRegExp("aXbxc", /x/gi, "-")) + " " + show(byRegExp("abc", /(?<n>b)/g, "[$<n>$1]")) + " " + show(byRegExp("", /^/g, "x")) + " " + show(byRegExp("abc", /(?:)/g, "-")) + " " + show(byRegExp(box + "a" + box, /\u2500/gu, "=")));
print(brief(() => byRegExp("abc", /b/, "x")) + " " + brief(() => byRegExp("abc", /b/y, "x")) + " " + brief(() => byRegExpAndFunction("abc", /b/, (m) => m)) + " " + brief(() => byAnything("abc", /b/, "x")));
function brief(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name + ": " + e.message;
  }
}
print(show(byRegExpAndFunction("a1b22", /(\d)(\d)?/g, (m, p, q, at, whole) => `{${m}|${p}|${q}|${at}|${whole}}`)) + " " + show(byFunction("a;b;c", ";", (m, at, whole) => `(${m}${at}${whole.length})`)) + " " + show(byFunction("abc", "", (m, at) => String(at))));
{
  const r = /b/g;
  r.lastIndex = 2;
  print(show(byRegExp("abcabc", r, "x")) + r.lastIndex);
}
{
  const r = /b/g;
  r.exec = () => null;
  print(show(byRegExp("abc", r, "x")));
}
{
  const r = /b/g;
  Object.defineProperty(r, "flags", { value: "" });
  print(brief(() => byRegExp("abc", r, "x")));
}
{

  class Mine extends RegExp {
    [Symbol.replace](s, b) {
      return "mine:" + s + ":" + b;
    }
  }
  print(show(byRegExp("abc", new Mine("b", "g"), "x")));
}
print([[";", "-"], [1, 2], [null, undefined], [undefined, "u"], [{ toString() {
  return "b";
} }, { toString() {
  return "B";
} }], [{ [Symbol.replace](s, b) {
  return "own " + s + b;
} }, "!"], [{ [Symbol.match]: true, flags: "g", toString() {
  return "b";
} }, "M"], [{ [Symbol.match]: true, flags: "", toString() {
  return "b";
} }, "M"]].map(([a, b]) => brief(() => byAnything("a;b1nullundefined", a, b))).join(" "));
print(attempt(() => texts(undefined, "a", "b")) + " " + attempt(() => byRegExp(null, /a/g, "b")) + " " + attempt(() => byRegExp("a", undefined, "b")) + " " + attempt(() => byRegExp("anull", null, "b")));
globalThis.kept = [texts, byRegExp, byRegExpAndFunction, byFunction, byAnything];
console.log("number");

// `s[i]`, `charAt`, `at` and `charCodeAt` inside and outside loops, on every internal representation of a string and with every kind of index (the same program without type annotations).
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
export function byIndex(s, i) {
  return s[i];
}
export function byCharAt(s, i) {
  return s.charAt(i);
}
export function byAt(s, i) {
  return s.at(i);
}
export function byCharCodeAt(s, i) {
  return s.charCodeAt(i);
}
export function byCodePointAt(s, i) {
  return s.codePointAt(i);
}
export function first(s) {
  return s[0] + "|" + s.charAt(0) + "|" + s.at(0) + "|" + s.charCodeAt(0);
}
export function last(s) {
  return s[s.length - 1] + "|" + s.charAt(s.length - 1) + "|" + s.at(-1) + "|" + s.charCodeAt(s.length - 1);
}
export function startsWithSlash(s) {
  return s[0] === "/";
}
export function endsWithNewline(s) {
  return s.at(-1) === `
`;
}
export function isDigitAt(s, i) {
  const c = s.charCodeAt(i);
  return c >= 48 && c <= 57;
}
export function sameAt(a, b, i) {
  return "" + Number(a[i] === b[i]) + Number(a.charAt(i) === b.charAt(i)) + Number(a.charCodeAt(i) === b.charCodeAt(i)) + Number(a.at(i) === b.at(i));
}
export function untyped(s, i) {
  return [s[i], s.charAt(i), s.at(i), s.charCodeAt(i)].join("|");
}
export function byInteger(s, i) {
  const j = i | 0;
  return s[j] + "|" + s.charAt(j) + "|" + s.at(j) + "|" + s.charCodeAt(j);
}
export function recorded(s) {
  return { a: 1, b: s.charAt(1), c: s.charCodeAt(0), d: s[2] };
}
export function handled(s, i) {
  let c = "?";
  try {
    c = s[i];
    if (i === 1)
      throw new Error("x");
    return "r" + c;
  } catch {
    return "c" + c + s.charAt(i);
  }
}
export function byIndexL(s, i, n) {
  let r = undefined;
  for (let k = 0;k < n; k++)
    r = s[i];
  return r;
}
export function byCharAtL(s, i, n) {
  let r = "";
  for (let k = 0;k < n; k++)
    r = s.charAt(i);
  return r;
}
export function byAtL(s, i, n) {
  let r = undefined;
  for (let k = 0;k < n; k++)
    r = s.at(i);
  return r;
}
export function byCharCodeAtL(s, i, n) {
  let r = 0;
  for (let k = 0;k < n; k++)
    r = s.charCodeAt(i);
  return r;
}
export function byCodePointAtL(s, i, n) {
  let r = undefined;
  for (let k = 0;k < n; k++)
    r = s.codePointAt(i);
  return r;
}
const f = { byIndex, byCharAt, byAt, byCharCodeAt, byCodePointAt, first, last, startsWithSlash, endsWithNewline, isDigitAt, sameAt, untyped, byInteger, recorded, handled };
const unseen = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f))
  f[name] = unseen(f[name]);
const g = { byIndexL, byCharAtL, byAtL, byCharCodeAtL, byCodePointAtL };
const wide = (s) => ("\u65E5" + s).slice(1);
const rope = (s) => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s) => {
  let out = "";
  for (const c of s)
    out = out + c;
  return out;
};
const wideRope = (s) => s.length < 2 ? wide(s) : wide(s.slice(0, 1)) + s.slice(1);
const cutOut = (s) => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfRope = (s) => rope("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s) => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s) => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s) => String.fromCharCode(...[...s].map((c) => c.charCodeAt(0)));
const kinds = [["same", (s) => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["wideRope", wideRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["partOfRope", cutOutOfRope], ["fresh", fresh]];
const places = [0, 1, 2, 3, 5, 6, 7, 99, -1, -2, -6, -7, -99, 0.5, 1.5, -0.5, -1.5, NaN, 1 / 0, -1 / 0, -0, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 4294967297, 9007199254740991, -9007199254740991, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000, -1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000];
const texts = ["", "a", "/", "ab", "abcdef", `/usr/bin
`, "caf\xE9", "\xFF\u0100", "\u65E5\u672C\u8A9E", "a\uD83D\uDE00b", "\uD83D", "\x00\x01"];
for (const [name, make] of kinds)
  print(name + ": " + texts.map((t) => show(t) + "=" + places.map((i) => [f.byIndex(make(t), i), f.byCharAt(make(t), i), f.byAt(make(t), i), f.byCharCodeAt(make(t), i), f.byCodePointAt(make(t), i)].map((x) => x === undefined ? "u" : typeof x === "string" ? x === "" ? "e" : x.charCodeAt(0).toString(36) : x !== x ? "n" : x.toString(36)).join("")).join(",")).join(" "));
for (const [name, make] of kinds)
  print(name + ": " + texts.map((t) => [show(f.first(make(t))), show(f.last(make(t))), Number(f.startsWithSlash(make(t))), Number(f.endsWithNewline(make(t))), Number(f.isDigitAt(make(t + "7"), t.length)), f.sameAt(make(t), make(t + "x"), t.length), f.sameAt(make(t), wide(t), 0), show(f.byInteger(make(t), 1.9)), show(f.byInteger(make(t), -1)), show(f.handled(make(t), 0)), show(f.handled(make(t), 1)), JSON.stringify(f.recorded(make(t)))].join("/")).join(" "));
print([f.byIndex("abc", 1) === "b", f.byCharAt(wide("abc"), 1) === "b", f.byAt(rope("abc"), -1) === "c", f.byIndex("\u65E5\u672C", 1) === "\u672C", f.byCharAt("abc", 9) === "", f.byIndex("abc", 9) === undefined, Object.is(f.byCharCodeAt("abc", 9), NaN), Object.is(f.byCharCodeAt("abc", -1), NaN)].join());
print([() => f.untyped("abc", 1), () => f.untyped("abc", "1"), () => f.untyped("abc", -1), () => f.untyped("abc", null), () => f.untyped("abc", undefined), () => f.untyped("abc", { valueOf: () => 2 }), () => f.untyped("abc", "length"), () => f.untyped(rope("abcd"), 3), () => f.untyped(["x", "y"], 1), () => f.untyped(5, 0), () => f.untyped(null, 0), () => f.byIndex(undefined, 0), () => f.byCharAt(null, 0), () => f.byCharCodeAt(undefined, 0)].map(attempt).join(" "));
{
  let compared = 0, differ = 0;
  const same = (a, b) => Object.is(a, b);
  for (const [, make] of kinds)
    for (const t of texts)
      for (const i of places)
        for (const n of ["byIndex", "byCharAt", "byAt", "byCharCodeAt", "byCodePointAt"]) {
          compared++;
          if (!same(f[n](make(t), i), g[n + "L"](make(t), i, 1)))
            differ++;
        }
  print("the stub against the code in place: " + compared + " compared, " + differ + " differ");
}
{
  let n = 0;
  for (let i = 0;i < 40000; i++) {
    const s = (i % 3 ? "/path" : "path") + i + (i % 4 ? "" : `
`);
    if (f.startsWithSlash(s))
      n++;
    if (f.endsWithNewline(s))
      n += 2;
    n += f.byCharCodeAt(s, i % 9) | 0;
    if (f.isDigitAt(i % 5 ? s : rope(s), 5))
      n += 3;
  }
  print(String(n));
}
globalThis.kept = [byIndex, byCharAt, byAt, byCharCodeAt, byCodePointAt, first, last, startsWithSlash, endsWithNewline, isDigitAt, sameAt, untyped, byInteger, recorded, handled, byIndexL, byCharAtL, byAtL, byCharCodeAtL, byCodePointAtL];
console.log("number");

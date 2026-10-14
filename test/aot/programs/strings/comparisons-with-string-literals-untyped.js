// `s === "literal"` inside and outside loops, for every length, every internal representation of the string and every kind of value (the same program without type annotations).
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
export function is1(s) {
  return s === "a";
}
export function is2(s) {
  return s === "ab";
}
export function is3(s) {
  return s === "abc";
}
export function is4(s) {
  return s === "abcd";
}
export function is5(s) {
  return s === "abcde";
}
export function is6(s) {
  return s === "abcdef";
}
export function is7(s) {
  return s === "abcdefg";
}
export function is8(s) {
  return s === "abcdefgh";
}
export function is9(s) {
  return s === "abcdefghi";
}
export function is10(s) {
  return s === "abcdefghij";
}
export function is12(s) {
  return s === "abcdefghijkl";
}
export function is15(s) {
  return s === "abcdefghijklmno";
}
export function is16(s) {
  return s === "abcdefghijklmnop";
}
export function is17(s) {
  return s === "abcdefghijklmnopq";
}
export function is23(s) {
  return s === "abcdefghijklmnopqrstuvw";
}
export function is24(s) {
  return s === "abcdefghijklmnopqrstuvwx";
}
export function is25(s) {
  return s === "abcdefghijklmnopqrstuvwxy";
}
export function is31(s) {
  return s === "abcdefghijklmnopqrstuvwxyz01234";
}
export function is32(s) {
  return s === "abcdefghijklmnopqrstuvwxyz012345";
}
export function is33(s) {
  return s === "abcdefghijklmnopqrstuvwxyz0123456";
}
export function is40(s) {
  return s === "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
}
export function is64(s) {
  return s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
}
export function is65(s) {
  return s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.";
}
export function branch1(s) {
  if (s === "alpha")
    return "A";
  return "-";
}
export function branch2(s) {
  if (s === "alpha")
    return "A";
  else if (s === "beta")
    return "B";
  return "-";
}
export function branch3(s) {
  if (s === "alpha")
    return "A";
  else if (s === "beta")
    return "B";
  else if (s === "gamma")
    return "G";
  return "-";
}
export function switched(s) {
  switch (s) {
    case "one":
      return 1;
    case "two":
      return 2;
    case "three":
      return 3;
    case "four":
      return 4;
    case "fourteen":
      return 14;
    default:
      return 0;
  }
}
export function inLoop(list) {
  let n = 0;
  for (const s of list)
    if (s === "alpha")
      n++;
  return n;
}
export function ofAny(x) {
  return x === "hello";
}
export function ofUnion(x) {
  return x === "hello";
}
export function ofNullable(x) {
  return x === "hello";
}
export function ofTexts(t) {
  return t === "beta";
}
export function ofField(o) {
  return o.kind === "beta";
}
export function isNot(s) {
  return s !== "hello";
}
export function chosen(s) {
  return s === "hello" ? 1 : s === "world" ? 2 : 3;
}
export function both(a, b) {
  return a === "left" && b === "right";
}
export function loosely(x) {
  return x == "12";
}
export function isEmpty(s) {
  return s === "";
}
export function isAccented(s) {
  return s === "caf\xE9";
}
export function isWide(s) {
  return s === "\u65E5\u672C";
}
export function isOdd(s) {
  return [s === "\x00", s === "a\x00b", s === `
`, s === "\x7F", s === `"'\\`, s === " "].map(Number).join("");
}
export function recorded(s) {
  return { a: 1, b: s === "x1", c: 2, d: s !== "yy" };
}
export function is1L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "a";
  return r;
}
export function is2L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "ab";
  return r;
}
export function is3L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abc";
  return r;
}
export function is4L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcd";
  return r;
}
export function is5L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcde";
  return r;
}
export function is6L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdef";
  return r;
}
export function is7L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefg";
  return r;
}
export function is8L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefgh";
  return r;
}
export function is9L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghi";
  return r;
}
export function is10L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghij";
  return r;
}
export function is12L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijkl";
  return r;
}
export function is15L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmno";
  return r;
}
export function is16L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnop";
  return r;
}
export function is17L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopq";
  return r;
}
export function is23L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvw";
  return r;
}
export function is24L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwx";
  return r;
}
export function is25L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwxy";
  return r;
}
export function is31L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwxyz01234";
  return r;
}
export function is32L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwxyz012345";
  return r;
}
export function is33L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwxyz0123456";
  return r;
}
export function is40L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
  return r;
}
export function is64L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
  return r;
}
export function is65L(s, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.";
  return r;
}
export function ofAnyL(x, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = x === "hello";
  return r;
}
const f = { recorded, branch1, branch2, branch3, switched, inLoop, ofAny, ofUnion, ofNullable, ofTexts, ofField, isNot, chosen, both, loosely, isEmpty, isAccented, isWide, isOdd, is5 };
const unseen = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f))
  f[name] = unseen(f[name]);
const g = { is1L, is2L, is3L, is4L, is5L, is6L, is7L, is8L, is9L, is10L, is12L, is15L, is16L, is17L, is23L, is24L, is25L, is31L, is32L, is33L, is40L, is64L, is65L, ofAnyL };
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.";
const all = [[1, is1], [2, is2], [3, is3], [4, is4], [5, is5], [6, is6], [7, is7], [8, is8], [9, is9], [10, is10], [12, is12], [15, is15], [16, is16], [17, is17], [23, is23], [24, is24], [25, is25], [31, is31], [32, is32], [33, is33], [40, is40], [64, is64], [65, is65]];
for (const pair of all)
  pair[1] = unseen(pair[1]);
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
const cutOutOfWide = (s) => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s) => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s) => String.fromCharCode(...[...s].map((c) => c.charCodeAt(0)));
const parsed = (s) => JSON.parse(JSON.stringify(s));
const key = (s) => Object.keys({ [s]: 1 })[0];
const kinds = [["same", (s) => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["wideRope", wideRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["fresh", fresh], ["parsed", parsed], ["key", key]];
for (const [name, make] of kinds) {
  let out = name + ":";
  for (const [n, is] of all) {
    const text = alphabet.slice(0, n);
    const changed = (at) => text.slice(0, at) + "#" + text.slice(at + 1);
    out += " " + n + "=" + [is(make(text)), is(make(changed(0))), is(make(changed(n - 1))), is(make(changed(n >> 1))), is(make(text + "x")), is(make(text.slice(1))), is(make(text.toUpperCase())), is(make(changed(n - 1).replace("#", "\xE9"))), is(make(changed(0).replace("#", "\u0161")))].map(Number).join("");
  }
  print(out);
}
for (const [name, make] of kinds)
  print(name + ": " + ["alpha", "beta", "gamma", "alph", "alphaa", "Alpha", "", "one", "two", "three", "four", "fourteen", "fourteeN", "hello", "world"].map((t) => {
    const s = make(t);
    return f.branch1(s) + f.branch2(s) + f.branch3(s) + f.switched(s) + Number(f.isNot(s)) + f.chosen(s) + Number(f.isEmpty(s)) + Number(f.ofNullable(s)) + Number(f.ofAny(s)) + Number(f.ofUnion(s)) + Number(f.ofField({ kind: s }));
  }).join(" ") + " " + f.inLoop(["alpha", "beta", "alpha", "alph"].map(make)) + Number(f.both(make("left"), make("right"))) + Number(f.both(make("left"), make("righ"))));
print([undefined, null, 0, 12, NaN, true, false, {}, [], ["hello"], { toString: () => "hello" }, Symbol.iterator, 12n, () => "hello", new String("hello"), "hello"].map((x) => "" + Number(f.ofAny(x)) + Number(f.loosely(x))).join(" ") + " " + [f.ofUnion(undefined), f.ofUnion(5), f.ofNullable(null), f.ofNullable(undefined), f.ofTexts("beta"), f.ofTexts("gamma"), f.ofTexts(rope("beta")), f.ofTexts(wide("beta"))].map(Number).join(""));
print(["caf\xE9", "cafe", wide("caf\xE9"), rope("caf\xE9"), "caf\xE8", "cafe\u0301", "\u65E5\u672C", rope("\u65E5\u672C"), "\u65E5", "\u65E5\u672C\u8A9E"].map((s) => "" + Number(f.isAccented(s)) + Number(f.isWide(s))).join(" ") + " " + ["\x00", "a\x00b", `
`, "\x7F", `"'\\`, " ", "", "a\x00c", wide("a\x00b"), rope("a\x00b")].map((s) => f.isOdd(s)).join(" "));
{
  let n = 0;
  for (let i = 0;i < 40000; i++) {
    const s = i % 3 ? "hello" : i % 5 ? "hell" + (i & 1 ? "o" : "a") : "help" + i;
    if (f.ofAny(s))
      n++;
    if (f.is5(i % 7 ? "abcde" : "abcd" + (i & 7)))
      n += 2;
    n += f.chosen(s);
  }
  print(String(n));
}
print(["x1", "yy", "", "x2"].map((s) => JSON.stringify(f.recorded(s))).join());
{
  let compared = 0, differ = 0;
  for (const [, make] of kinds)
    for (const [n, is] of all) {
      const text = alphabet.slice(0, n);
      for (const t of [text, "#" + text.slice(1), text.slice(0, -1) + "#", text.slice(0, n >> 1) + "#" + text.slice((n >> 1) + 1), text + "x", text.slice(1), "", text.slice(0, -1) + "\xE9", text.slice(0, -1) + "\u0161", text.toUpperCase()]) {
        compared++;
        if (is(make(t)) !== g["is" + n + "L"](make(t), 1))
          differ++;
      }
    }
  for (const x of ["hello", rope("hello"), wide("hello"), "hellp", "", 5, null, undefined, {}, ["hello"], new String("hello"), Symbol.iterator, 1n, true]) {
    compared++;
    if (f.ofAny(x) !== g.ofAnyL(x, 1))
      differ++;
  }
  print("the stub against the code in place: " + compared + " compared, " + differ + " differ");
}
globalThis.kept = [is1L, is2L, is3L, is4L, is5L, is6L, is7L, is8L, is9L, is10L, is12L, is15L, is16L, is17L, is23L, is24L, is25L, is31L, is32L, is33L, is40L, is64L, is65L, ofAnyL, recorded, is1, is2, is3, is4, is5, is6, is7, is8, is9, is10, is12, is15, is16, is17, is23, is24, is25, is31, is32, is33, is40, is64, is65, branch1, branch2, branch3, switched, inLoop, ofAny, ofUnion, ofNullable, ofTexts, ofField, isNot, chosen, both, loosely, isEmpty, isAccented, isWide, isOdd];
console.log("number");

// `slice`, `substring`, `substr` and the `trim` methods inside and outside loops, on every internal representation of a string (the same program without type annotations).
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
export function sliced(s, a, b) {
  return s.slice(a, b);
}
export function slicedFrom(s, a) {
  return s.slice(a);
}
export function slicedOne(s) {
  return s.slice(1);
}
export function slicedLast(s) {
  return s.slice(-1) + "|" + s.slice(0, -1) + "|" + s.slice(0, 1) + "|" + s.slice(2, 4);
}
export function substringed(s, a, b) {
  return s.substring(a, b);
}
export function substred(s, a, b) {
  return s.substr(a, b);
}
export function slicedUntyped(s, a, b) {
  return s.slice(a, b);
}
export function trimmed(s) {
  return s.trim();
}
export function trimmedStart(s) {
  return s.trimStart();
}
export function trimmedEnd(s) {
  return s.trimEnd();
}
export function trimmedUntyped(s) {
  return s.trim();
}
export function slicedInLoop(list) {
  let out = "";
  for (const s of list)
    out += s.slice(1, 3) + ",";
  return out;
}
export function trimmedInLoop(list) {
  let out = "";
  for (const s of list)
    out += "[" + s.trim() + "]";
  return out;
}
export function recorded(s) {
  return { a: 1, b: s.slice(1), c: s.trim(), d: 2 };
}
export function slicedL(s, a, b, n) {
  let r = "";
  for (let k = 0;k < n; k++)
    r = s.slice(a, b);
  return r;
}
export function substringedL(s, a, b, n) {
  let r = "";
  for (let k = 0;k < n; k++)
    r = s.substring(a, b);
  return r;
}
export function substredL(s, a, b, n) {
  let r = "";
  for (let k = 0;k < n; k++)
    r = s.substr(a, b);
  return r;
}
export function trimmedL(s, n) {
  let r = "";
  for (let k = 0;k < n; k++)
    r = s.trim();
  return r;
}
export function trimmedStartL(s, n) {
  let r = "";
  for (let k = 0;k < n; k++)
    r = s.trimStart();
  return r;
}
export function trimmedEndL(s, n) {
  let r = "";
  for (let k = 0;k < n; k++)
    r = s.trimEnd();
  return r;
}
const f = { recorded, sliced, slicedFrom, slicedOne, slicedLast, substringed, substred, slicedUntyped, trimmed, trimmedStart, trimmedEnd, trimmedUntyped, slicedInLoop, trimmedInLoop };
const unseen = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f))
  f[name] = unseen(f[name]);
const g = { slicedL, substringedL, substredL, trimmedL, trimmedStartL, trimmedEndL };
const wide = (s) => ("\u65E5" + s).slice(1);
const rope = (s) => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s) => {
  let out = "";
  for (const c of s)
    out = out + c;
  return out;
};
const cutOut = (s) => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfRope = (s) => rope("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s) => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s) => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s) => String.fromCharCode(...[...s].map((c) => c.charCodeAt(0)));
const kinds = [["same", (s) => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["partOfRope", cutOutOfRope], ["fresh", fresh]];
const places = [0, 1, 2, 3, 5, 6, 7, 99, -1, -2, -6, -7, -99, 1.5, -1.5, NaN, 1 / 0, -1 / 0, -0, 2147483648, -2147483649, 4294967297];
for (const [name, make] of kinds) {
  for (const text of ["", "a", "ab", "abcdef", "caf\xE9 au lait", "\u65E5\u672C\u8A9E\u306E", "a\uD83D\uDE00b"]) {
    let h = 0, sample = "";
    for (const a of places)
      for (const b of places) {
        const got = [f.sliced(make(text), a, b), f.substringed(make(text), a, b), f.substred(make(text), a, b), f.slicedUntyped(make(text), a, b)].join("\x01");
        for (let i = 0;i < got.length; i++)
          h = Math.imul(h, 31) + got.charCodeAt(i) | 0;
        if (a === 1 && b === 3)
          sample = show(got);
      }
    print(name + " " + show(text) + " " + h + " " + sample + " " + places.map((a) => f.slicedFrom(make(text), a).length).join("") + " " + show(f.slicedOne(make(text))) + show(f.slicedLast(make(text))));
  }
}
{
  const s = fresh("abcdef");
  print([f.sliced(s, 0, 6) === s, f.slicedFrom(s, 0) === s, f.trimmed(s) === s, f.sliced(s, 2, 2) === "", f.sliced(s, 4, 2) === "", f.sliced(s, 2, 3) === "c", f.sliced(wide("abc"), 1, 2) === "b", f.sliced("\u65E5\u672C", 1, 2) === "\u672C"].join());
}
{
  const parts = [];
  let s = "0123456789".repeat(20);
  while (s.length > 2) {
    s = f.sliced(s, 1, s.length - 1);
    parts.push(s[0] + s.length);
  }
  print(parts.join("").length + " " + parts.slice(-3).join());
}
const spaces = ["", " ", "  ", "\t", `
`, "\v", "\f", "\r", "\xA0", ` 	
\v\f\r\xA0`, "\x85", "\u200B", "\x1F", "\x0E", "\b", "!", "\u1680", "\u2000", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\uFEFF", "\u180E"];
for (const [name, make] of kinds)
  print(name + ": " + spaces.map((w) => ["", "x", "x y", "\xE9", "\u65E5"].map((core) => {
    const s = make(w + core + w);
    return [f.trimmed(s), f.trimmedStart(s), f.trimmedEnd(s), f.trimmedUntyped(s)].map((t) => t.length).join("");
  }).join(".")).join(" "));
print([f.slicedInLoop(["abcd", "x", "", wide("abcd"), rope("abcd")]), f.trimmedInLoop([" a ", "", "  ", wide(" b "), rope("  c  ")])].join(" ") + " " + [() => f.slicedUntyped(undefined, 0, 1), () => f.slicedUntyped(12345, 1, 3), () => f.slicedUntyped([1, 2, 3], 1, 3), () => f.slicedUntyped("abcdef", "1", "3"), () => f.slicedUntyped("abcdef", { valueOf: () => 2 }, undefined), () => f.slicedUntyped("abcdef", null, true), () => f.trimmedUntyped(null), () => f.trimmedUntyped({ trim: () => "mine" }), () => f.sliced(null, 0, 1), () => f.trimmed(undefined)].map(attempt).join());
{
  let n = 0;
  for (let i = 0;i < 30000; i++) {
    const s = "  line " + i + (i % 3 ? " " : "");
    n += f.trimmed(s).length + f.sliced(s, i % 5, 9).length + f.slicedOne(s).length;
  }
  print(String(n));
}
print([" ab ", "", "x", rope("  abcd  ")].map((s) => JSON.stringify(f.recorded(s))).join());
{
  const held = [];
  const base = fresh("0123456789abcdefghijklmnopqrstuvwxyz");
  for (let i = 0;i < 1e5; i++)
    held.push(i & 1 ? f.sliced(base, i % 30, i % 30 + 2 + i % 5) : f.trimmed(" " + base.slice(i % 20, i % 20 + 3 + i % 7) + i + " "));
  let h = 0;
  for (const s of held)
    for (let i = 0;i < s.length; i++)
      h = Math.imul(h, 31) + s.charCodeAt(i) | 0;
  print(held.length + " " + h);
}
{
  let compared = 0, differ = 0;
  for (const [, make] of kinds) {
    for (const text of ["", "a", "ab", "abcdef", "caf\xE9 au lait", "\u65E5\u672C\u8A9E\u306E", "a\uD83D\uDE00b"])
      for (const a of places)
        for (const b of places) {
          compared += 3;
          if (f.sliced(make(text), a, b) !== g.slicedL(make(text), a, b, 1))
            differ++;
          if (f.substringed(make(text), a, b) !== g.substringedL(make(text), a, b, 1))
            differ++;
          if (f.substred(make(text), a, b) !== g.substredL(make(text), a, b, 1))
            differ++;
        }
    for (const w of spaces)
      for (const v of spaces)
        for (const core of ["", "x", "x y", "\xE9", "\u65E5"]) {
          compared += 3;
          const t = w + core + v;
          if (f.trimmed(make(t)) !== g.trimmedL(make(t), 1))
            differ++;
          if (f.trimmedStart(make(t)) !== g.trimmedStartL(make(t), 1))
            differ++;
          if (f.trimmedEnd(make(t)) !== g.trimmedEndL(make(t), 1))
            differ++;
        }
  }
  print("the stubs against the code in place: " + compared + " compared, " + differ + " differ");
}
globalThis.kept = [slicedL, substringedL, substredL, trimmedL, trimmedStartL, trimmedEndL, recorded, sliced, slicedFrom, slicedOne, slicedLast, substringed, substred, slicedUntyped, trimmed, trimmedStart, trimmedEnd, trimmedUntyped, slicedInLoop, trimmedInLoop];
console.log("number");

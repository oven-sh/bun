// `===` and `!==` between values of unknown type: every pair of kinds of values (the same program without type annotations).
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
function fresh(s) {
  return Array.from(s).join("");
}
function wide(s) {
  return flattened(("\u65E5" + s).slice(1));
}
const texts = [
  "",
  "a",
  "b",
  "ab",
  "ac",
  "bb",
  "abcdefg",
  "abcdefh",
  "bbcdefg",
  "abcdefgh",
  "abcdefgi",
  "bbcdefgh",
  "abcdefghi",
  "abcdefghj",
  "abcdefgxi",
  "bbcdefghi",
  "abcdefghijklmno",
  "abcdefghijklmnp",
  "abcdefgxijklmno",
  "abcdefghijklmnop",
  "abcdefghijklmnoq",
  "abcdefghxjklmnop",
  "abcdefghijklmnopq",
  "abcdefghijklmnopr",
  "abcdefghijklmnopqrstuvwxyz0123456789",
  "abcdefghijklmnopqrstuvwxyz012345678x",
  "abcdefghijklmnopqrstuvwxyz0x23456789",
  "xbcdefghijklmnopqrstuvwxyz0123456789",
  "caf\xE9",
  "caf\xE8",
  "identifier",
  "expression",
  "\xFF\xFE\xFD\xFC\xFB\xFA\xF9\xF8\xF7"
];
const values = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, 10n, 10n ** 30n, Symbol.iterator, {}, [], "\u65E5\u672C", "\u65E5\u672D", "\u65E5"];
for (const t of texts) {
  values.push(t, fresh(t), JSON.parse(JSON.stringify(t)));
  if (t.length > 1)
    values.push(wide(t), cat(t.slice(0, 1), t.slice(1)), ("<" + t + ">").slice(1, -1), new String(t));
}
export function sameUnknown(a, b) {
  return a === b;
}
export function differsUnknown(a, b) {
  return a !== b;
}
export function isKind(o) {
  return "" + (o.kind === "identifier") + (o.kind === "expression") + (o.kind !== "abcdefgh") + (o.kind === "abcdefghijklmnopqrstuvwxyz0123456789") + (o.kind === "") + (o.kind === "caf\xE9") + (o.kind === "\u65E5\u672C");
}
let line = "";
let count = 0;
for (let i = 0;i < values.length; i++) {
  let row = 0;
  for (let j = 0;j < values.length; j++) {
    const s = sameUnknown(values[i], values[j]);
    if (s === differsUnknown(values[i], values[j]) || s !== sameUnknown(values[j], values[i]))
      print("inconsistent at " + i + ", " + j);
    if (s) {
      row = (row * 31 + j + 1) % 1000003;
      count++;
    }
  }
  line += " " + row;
}
print(values.length + " values, " + count + " pairs are the same:" + line);
for (const v of values)
  line = isKind({ kind: v }) + (typeof v === "string" ? " " + show(v) : "");
for (const t of ["identifier", "expression", "abcdefgh", "abcdefghijklmnopqrstuvwxyz0123456789", "", "caf\xE9", "\u65E5\u672C", "identifies", "Identifier", "abcdefghijklmnopqrstuvwxyz012345678x"]) {
  for (const v of [t, fresh(t), JSON.parse(JSON.stringify({ kind: t })).kind, t.length > 1 ? wide(t) : t, t.length > 1 ? cat(t.slice(0, 1), t.slice(1)) : t])
    print(show(t) + " " + isKind({ kind: v }));
}
globalThis.kept = [sameUnknown, isKind];
console.log("number");

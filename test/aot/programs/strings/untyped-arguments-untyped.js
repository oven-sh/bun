// Methods of strings called in code without types: the receiver and the arguments may be anything (the same program without type annotations).
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
function watched(name, value) {
  return { valueOf() {
    log.push(name + ".valueOf");
    return value;
  }, toString() {
    log.push(name + ".toString");
    return String(value);
  } };
}
export function unit(s, i) {
  return s.charCodeAt(i);
}
export function point(s, i) {
  return s.codePointAt(i);
}
export function charAt(s, i) {
  return s.charAt(i);
}
export function at(s, i) {
  return s.at(i);
}
export function slice(s, a, b) {
  return s.slice(a, b);
}
export function slice1(s, a) {
  return s.slice(a);
}
export function substring(s, a, b) {
  return s.substring(a, b);
}
export function includes(s, t) {
  return s.includes(t);
}
export function includesFrom(s, t, i) {
  return s.includes(t, i);
}
export function indexOf(s, t) {
  return s.indexOf(t);
}
export function lastIndexOf(s, t) {
  return s.lastIndexOf(t);
}
export function startsWith(s, t) {
  return s.startsWith(t);
}
export function endsWith(s, t, i) {
  return s.endsWith(t, i);
}
export function concat(s, t) {
  return s.concat(t);
}
export function text(s) {
  return s.toString();
}
function shown(x) {
  return Array.isArray(x) ? "[" + x.map(shown).join() + "]" : typeof x === "object" && x !== null ? "{" + Object.keys(x).join() + "}" : show(x);
}
function tried(f) {
  const before = log.length;
  let out;
  try {
    out = shown(f());
  } catch (e) {
    out = "throws " + e.name;
  }
  return out + (log.length > before ? "<" + log.splice(before).join() + ">" : "");
}
const receivers = [
  "",
  "a",
  "abcdef",
  "caf\xE9",
  "a\uD83D\uDE00b",
  cat("abc", "def"),
  part("xxabcdefxx", 2, 8),
  new String("abcdef"),
  [1, 2, 3, "c", "cd"],
  ["abcdef"],
  new Uint8Array([1, 2, 3]),
  12345,
  true,
  undefined,
  null,
  Symbol.iterator,
  10n,
  { charCodeAt: (i) => "mine" + typeof i, codePointAt: () => "mine", charAt: () => "mine", at: () => "mine", slice: (a, b) => "mine" + typeof a + typeof b, substring: () => "mine", includes: () => "mine", indexOf: () => "mine", lastIndexOf: () => "mine", startsWith: () => "mine", endsWith: () => "mine", concat: () => "mine", toString: () => "mine" },
  {},
  watched("r", "abcdef")
];
const numbers = [0, 1, 2, 5, 6, -1, -2, -0, 1.5, NaN, 1 / 0, -1 / 0, 2147483648, 9007199254740992, undefined, null, true, false, "1", "x", "", [], [2], {}, watched("n", 2), watched("m", "1"), Symbol.iterator, 1n];
const texts = ["", "a", "c", "cd", "f", "def", "abcdef", "abcdefg", "\xE9", "\uD83D\uDE00", "\uD83D", cat("c", "d"), 1, 2, 12, NaN, undefined, null, true, [], ["c"], {}, watched("t", "cd"), /c/, Symbol.iterator, 3n];
for (const s of receivers) {
  let line = tried(() => String(typeof s === "symbol" ? "symbol" : typeof s === "object" && s !== null ? Object.prototype.toString.call(s) : s)) + ":";
  for (const i of numbers)
    line += " " + tried(() => unit(s, i)) + "," + tried(() => point(s, i)) + "," + tried(() => charAt(s, i)) + "," + tried(() => at(s, i)) + "," + tried(() => slice1(s, i));
  print(line);
  line = "  parts:";
  for (const a of numbers)
    for (const b of [1, 4, -1, undefined, "3", watched("b", 3)])
      line += " " + tried(() => slice(s, a, b)) + "," + tried(() => substring(s, a, b));
  print(line);
  line = "  texts:";
  for (const t of texts)
    line += " " + tried(() => includes(s, t)) + "," + tried(() => indexOf(s, t)) + "," + tried(() => lastIndexOf(s, t)) + "," + tried(() => startsWith(s, t)) + "," + tried(() => concat(s, t)) + "," + tried(() => includesFrom(s, t, 2)) + "," + tried(() => includesFrom(s, t, watched("i", 1))) + "," + tried(() => endsWith(s, t, 4));
  print(line + " " + tried(() => text(s)));
}
globalThis.kept = [unit, point, charAt, at, slice, slice1, substring, includes, includesFrom, indexOf, lastIndexOf, startsWith, endsWith, concat, text];
console.log("number");

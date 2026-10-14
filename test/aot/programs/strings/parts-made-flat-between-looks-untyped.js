// A substring (the result of `slice`) is read, then flattened by a built-in function, then read again, with its base string collected in between (the same program without type annotations).
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
const collect = typeof gc === "function" ? gc : () => {};
const isPart = typeof isRope === "function" ? isRope : () => true;
const isFlat = typeof isRope === "function" ? (s) => !isRope(s) : () => true;
function flatten(s) {
  if (!isPart(s))
    throw new Error("no part");
  Symbol.for(s);
  if (!isFlat(s))
    throw new Error("not flat");
}
let litter = [];
function fill() {
  litter = [];
  for (let i = 0;i < 20000; i++)
    litter.push(("#".repeat(40) + i).slice(1, 30 + (i & 7)));
}
const unseen = (f) => new Function("f", "return (...a) => f(...a)")(f);
export function lengthThenSlice(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t.slice(2, 12);
}
export function codeThenSlice(t) {
  const n = t.charCodeAt(1);
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t.slice(2, 12);
}
export function sliceThenSlice(t) {
  const a = t.slice(1, 5);
  flatten(t);
  collect();
  fill();
  collect();
  return a + ":" + t.slice(2, 12);
}
export function lengthThenSubstring(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t.substring(3, 14);
}
export function lengthThenCode(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t.charCodeAt(4);
}
export function lengthThenIndex(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t[5];
}
export function lengthThenText(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + (t === "cdefghijklmnopqrstuvwxyz0123") + (t === "cdefghijklmnopqrstuvwxyz012?");
}
export function lengthThenStarts(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t.startsWith("cdef") + t.endsWith("0123") + t.startsWith("cdeg");
}
export function lengthThenTrim(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t.trim();
}
export function lengthThenEqual(t, u) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + (t === u);
}
export function lengthThenSearch(t) {
  const n = t.length;
  flatten(t);
  collect();
  fill();
  collect();
  return n + ":" + t.indexOf("xyz") + t.includes("0") + t.lastIndexOf("d");
}
const all = [["lengthThenSlice", lengthThenSlice], ["codeThenSlice", codeThenSlice], ["sliceThenSlice", sliceThenSlice], ["lengthThenSubstring", lengthThenSubstring], ["lengthThenCode", lengthThenCode], ["lengthThenIndex", lengthThenIndex], ["lengthThenText", lengthThenText], ["lengthThenStarts", lengthThenStarts], ["lengthThenTrim", lengthThenTrim], ["lengthThenEqual", lengthThenEqual], ["lengthThenSearch", lengthThenSearch]];
const fresh = (x) => String.fromCharCode(...[...x].map((c) => c.charCodeAt(0)));
const narrow = (i) => fresh("abcdefghijklmnopqrstuvwxyz0123456789" + i).slice(2, 30);
const wider = (i) => fresh("\u65E5bcdefghijklmnopqrstuvwxyz0123456789" + i).slice(2, 30);
function prepare(depth, into, make, from) {
  if (depth) {
    prepare(depth - 1, into, make, from);
    return;
  }
  for (let i = 0;i < 400; i++)
    into.push(make(from + i));
}
function overwrite(depth) {
  return depth ? overwrite(depth - 1) + depth : 0;
}
const narrowParts = [];
const widerParts = [];
unseen(prepare)(40, narrowParts, narrow, 0);
unseen(prepare)(40, widerParts, wider, 0);
unseen(overwrite)(200);
let next = 0;
for (const [name, f] of all) {
  const g = unseen(f);
  const seen = new Set;
  for (let i = 0;i < 6; i++) {
    seen.add(g(narrowParts[next], narrowParts[next + 1]));
    seen.add(g(widerParts[next], widerParts[next + 1]));
    next += 2;
  }
  print(name + ": " + [...seen].join(" | "));
}
globalThis.kept = all;
console.log("number");

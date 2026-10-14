// `[...map.values()]` and similar spreads of Maps and Sets with string keys, also when the collection changes between creating the iterator and spreading it (the same program without type annotations).
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
const make = (n = 4) => new Map(Array.from({ length: n }, (_, i) => ["k" + i, i]));
const makeSet = (n = 4) => new Set(Array.from({ length: n }, (_, i) => "s" + i));
const listed = (list) => list.length + ":" + list.map((x) => Array.isArray(x) ? x.join("=") : String(x)).join();
export function values(m) {
  return [...m.values()];
}
export function keys(m) {
  return [...m.keys()];
}
export function entries(m) {
  return [...m.entries()];
}
export function whole(m) {
  return [...m];
}
export function ofSet(s) {
  return [...s.values(), "|", ...s.keys(), "|", ...s];
}
export function between(m) {
  return ["<", ...m.keys(), "-", ...m.values(), ">"];
}
export function held(it) {
  return [...it];
}
print(listed(values(make())) + " " + listed(keys(make())) + " " + listed(entries(make())) + " " + listed(whole(make())) + " " + listed(ofSet(makeSet())) + " " + listed(between(make(2))));
print(listed(values(new Map)) + " " + listed(keys(new Map)) + " " + listed(ofSet(new Set)) + " " + listed(values(make(1))) + " " + values(make(300)).length + " " + keys(make(5000)).at(-1));
{
  const m = make(6);
  m.delete("k0");
  m.delete("k3");
  m.delete("k5");
  print(listed(values(m)) + " " + listed(keys(m)) + " " + listed(entries(m)));
  m.set("k0", 100);
  print(listed(entries(m)));
}
{
  const m = make();
  const it = m.values();
  m.set("late", 9);
  print("set " + listed(held(it)) + " again " + listed(held(it)));
}
{
  const m = make();
  const it = m.keys();
  m.delete("k1");
  print("delete " + listed(held(it)));
}
{
  const m = make();
  const it = m.entries();
  m.clear();
  print("clear " + listed(held(it)));
}
{
  const m = make();
  const it = m.values();
  m.clear();
  m.set("new", 1);
  print("clear, set " + listed(held(it)));
}
{
  const m = make();
  const it = m.values();
  for (let i = 0;i < 400; i++)
    m.set("g" + i, i);
  print("growth " + held(it).length);
}
{
  const m = make();
  const it = m.keys();
  m.set(7, 7);
  m.set({}, 8);
  print("other keys " + listed(held(it)));
}
{
  const m = make();
  const it = m.values();
  it.next();
  print("one step " + listed(held(it)) + " " + listed(held(it)));
}
{
  const m = make(2);
  const it = m.values();
  it.next();
  it.next();
  print("at the end " + listed(held(it)));
  m.set("x", 1);
  print(listed(held(it)));
}
{
  const m = make(2);
  const it = m.values();
  it.next();
  it.next();
  it.next();
  m.set("x", 1);
  print("used up " + listed(held(it)));
}
{
  const s = makeSet();
  const it = s.values();
  s.add("late");
  s.delete("s0");
  print("a set " + listed(held(it)));
  const e = s.entries();
  print(listed(held(e)));
}
{
  const m = make();
  const a = m.values(), b = m.values();
  print("two " + listed(held(a)) + " " + listed(held(b)) + " " + listed(held(a)));
}
{
  const m = make(3);
  const it = m.values();
  const list = held(it);
  list.push(99);
  print("its own " + listed(list) + " " + listed(values(m)));
}
{
  const m = new Map([[cat("ro", "pe"), 1], [part("xsubx", 1, 4), undefined], ["", null], ["\u65E5", NaN]]);
  print(listed([...m.values()]) + " " + listed([...m.keys()]));
}

class Own extends Map {
  values() {
    return [7, 8][Symbol.iterator]();
  }
}
print(listed(values(new Own([["a", 1]]))) + " " + listed(keys(new Own([["a", 1]]))));
globalThis.kept = [values, keys, entries, whole, ofSet, between, held];
console.log("number");

// A short concatenation of strings and numbers that is used as a lookup key in the same function is built as a flat string (the same program without type annotations).
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
export function getPair(m, a, b) {
  return m.get(a.id + "," + b.id);
}
export function hasTemplate(m, a, b, postfix) {
  return m.has(`${a.id},${b.id}${postfix}`);
}
export function cached(m, a, b) {
  const key = a.id + ":" + b.id;
  let found = m.get(key);
  if (found === undefined) {
    found = m.size;
    m.set(key, found);
  }
  return found;
}
export function addToSet(s, a, n) {
  s.add(a.name + "#" + n);
  return s.size;
}
export function throughJoin(m, a, b, swap) {
  let key;
  if (swap)
    key = b.id + "," + a.id;
  else
    key = a.id + "," + b.id;
  return m.get(key);
}
export function property(o, a, b) {
  return o[a.id + "_" + b.id];
}
export function returned(a, b) {
  return a.id + "," + b.id;
}
export function pixels(i) {
  return `${i & 1023}px`;
}
export function asValue(m, a, b) {
  m.set(a.id, a.id + "," + b.id);
  return m.size;
}
export function pushed(list, a, b) {
  return list.push(a.id + "," + b.id);
}
export function handled(m, a, b) {
  try {
    return m.get(a.id + "," + b.id);
  } catch {
    return -1;
  }
}
export function threeStrings(m, a, b) {
  return m.get(a.name + "," + b.name);
}
export function twoStrings(m, a, b) {
  const x = `${a.name}`, y = `${b.name}`;
  return m.get(x + y);
}
export function templateOfStrings(m, a, b) {
  return m.has(`${a.name},${b.name}`);
}
const numbers = [0, -0, 1, 9, 10, 1023, 1024, 65535, 123456, 2147483647, 2147483648, -1, -2147483648, -2147483649, 4294967295, 9007199254740992, 1000000000000000000000, 0.0000001, 0.1, -0.5, 1.5, NaN, 1 / 0, -1 / 0, 0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005];
const names = ["", "x", "@12", "caf\xE9", "\u65E5\u672C", "a".repeat(40), "a".repeat(52), "a".repeat(53), "a".repeat(64), "a".repeat(200), cat("ab", "cd"), cat3("a", "b", "c"), part("xxabcdefxx", 2, 8), flattened(cat("fl", "at"))];
const m = new Map;
const s = new Set;
const o = {};
const values = new Map;
const list = [];
let n = 0;
let bad = "";
for (const x of numbers)
  for (const y of numbers) {
    m.set([String(x), String(y)].join(","), n);
    o[[String(x), String(y)].join("_")] = n;
    for (const p of names)
      m.set([String(x), String(y)].join(",").concat(p), n);
    n++;
  }
n = 0;
for (const x of numbers)
  for (const y of numbers) {
    const a = { id: x, name: "n" }, b = { id: y, name: "m" };
    if (getPair(m, a, b) !== n)
      bad += " getPair " + x + " " + y;
    if (throughJoin(m, a, b, false) !== n || throughJoin(m, b, a, true) !== n)
      bad += " throughJoin " + x + " " + y;
    if (handled(m, a, b) !== n)
      bad += " handled " + x + " " + y;
    if (property(o, a, b) !== n)
      bad += " property " + x + " " + y;
    for (const p of names)
      if (!hasTemplate(m, a, b, p))
        bad += " hasTemplate " + x + " " + y + " " + show(p.slice(0, 8));
    if (hasTemplate(m, a, b, "?"))
      bad += " hasTemplate finds what is not there";
    if (returned(a, b) !== [String(x), String(y)].join(","))
      bad += " returned " + x + " " + y;
    n++;
  }
print("differences:" + bad);
const fresh = new Map;
let total = 0;
for (let round = 0;round < 3; round++)
  for (let i = 0;i < 400; i++)
    total += cached(fresh, { id: i * 37, name: "" }, { id: 1e5 - i, name: "" });
print(fresh.size + " " + total + " " + fresh.get("37:99999") + " " + [...fresh.keys()].slice(0, 3).map(show).join());
for (const p of names)
  for (const x of numbers)
    addToSet(s, { id: 0, name: p }, x);
let inSet = 0;
for (const p of names)
  for (const x of numbers)
    if (s.has(p.concat("#", String(x))))
      inSet++;
print(s.size + " " + inSet);
for (let i = 0;i < 5; i++) {
  asValue(values, { id: i, name: "" }, { id: i * i, name: "" });
  pushed(list, { id: i, name: "" }, { id: -i, name: "" });
}
print([...values.values()].map(show).join() + " " + list.map(show).join() + " " + pixels(5) + pixels(2047) + pixels(-1));
print(String(threeStrings(new Map([["n,m", 7]]), { id: 0, name: "n" }, { id: 0, name: "m" })));
{
  const byName = new Map;
  let k = 0, wrong = "";
  for (const p of names)
    for (const q of names) {
      byName.set([p, q].join(""), k);
      byName.set([p, q].join(","), k);
      k++;
    }
  for (const p of names)
    for (const q of names) {
      const a = { id: 0, name: p }, b = { id: 0, name: q };
      if (twoStrings(byName, a, b) !== byName.get(p.concat(q)))
        wrong += " two " + show(p.slice(0, 6)) + show(q.slice(0, 6));
      if (!templateOfStrings(byName, a, b))
        wrong += " template " + show(p.slice(0, 6)) + show(q.slice(0, 6));
    }
  const empty = { id: 0, name: "" }, alsoEmpty = { id: 0, name: part("xx", 1, 1) };
  print("strings:" + wrong + " " + twoStrings(byName, empty, alsoEmpty) + " " + (empty.name + alsoEmpty.name === "") + " " + byName.size);
}
globalThis.kept = [getPair, hasTemplate, cached, addToSet, throughJoin, property, returned, pixels, asValue, pushed, handled, threeStrings, twoStrings, templateOfStrings];
console.log("number");

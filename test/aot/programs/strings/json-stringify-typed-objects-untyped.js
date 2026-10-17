// `JSON.stringify` of typed objects: every kind of field, every order of keys, and everything that leaves the fast path (the same program without type annotations).
class Plain {
  x = 1;
  y = "two";
  z = [3];
}

class WithMethods {
  x = 1;
  method() {
    return 2;
  }
  get computed() {
    return 3;
  }
  static fixed = 4;
}

class WithPrivate {
  #hidden = 1;
  shown = 2;
  reveal() {
    return this.#hidden;
  }
}

class WithToJSON {
  x = 1;
  toJSON() {
    return { replaced: this.x };
  }
}

class WithKey {
  x = 1;
  toJSON(key) {
    return "key " + key;
  }
}

class OwnToJSON {
  x = 1;
  toJSON = 5;
}

class OwnCallable {
  x = 1;
  toJSON = () => "own";
}

class WithAccessor {
  _v = 1;
  get v() {
    return this._v;
  }
  set v(n) {
    this._v = n;
  }
}
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
const forms = (x) => attempt(() => JSON.stringify(x)) + " " + attempt(() => JSON.stringify(x, null, 2)) + " " + attempt(() => JSON.stringify(x, null, "\t")) + " " + attempt(() => JSON.stringify([x, x])) + " " + attempt(() => JSON.stringify({ wrapped: x }));
const mixed = { a: 1, b: [1, 2, 3], c: { d: "x" }, e: null, f: true };
print(forms(mixed));
for (const n of [0, -0, 1, -1, 2147483647, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, 2147483648, 4294967295, 1.5, -1.5, 1000000000000000000000, 0.0000001, 9007199254740991, NaN, 1 / 0, -1 / 0]) {
  const p = { x: n, y: 0 };
  p.y = n;
  print(forms(p));
}
for (const s of ["", "x", 'with "quotes" and \\', `
	\r\b\f\x00\x1F`, "caf\xE9", "\u65E5\u672C", "\uD83D\uDE00", "\uD800", "\uDC00x", "</script>", "\u2028\u2029", "\x7F\x80", cat("ro", "pe"), part("a substring here", 2, 11), "long ".repeat(40), "x".repeat(5000)])
  print(forms({ d: s }).length + " " + forms({ d: s }).slice(0, 300));
const optionals = [{}, { a: 1 }, { b: "s" }, { c: false }, { d: { x: 1, y: 2 } }, { e: null }, { e: 5 }, { f: undefined }, { f: "f" }, { g: null }, { g: true }, { a: undefined }, { a: 1, b: "s", c: true, d: { x: 1, y: 2 }, e: null, f: "f", g: false }, { g: false, f: "f", e: 1, d: { y: 2, x: 1 }, c: true, b: "s", a: 1 }];
for (const o of optionals)
  print(forms(o));
function inOrder(keys) {
  const o = {};
  for (const k of keys) {
    if (k === "a")
      o.a = 1;
    else if (k === "b")
      o.b = "s";
    else if (k === "c")
      o.c = true;
    else if (k === "e")
      o.e = 2;
    else if (k === "g")
      o.g = null;
  }
  return o;
}
for (const keys of ["abc", "cba", "bca", "eag", "gea", "a", "ga", "abceg", "gecba", "cabge"])
  print(keys + " " + forms(inOrder(keys)));
{
  const o = inOrder("abc");
  delete o.b;
  print(forms(o));
  o.b = "again";
  print(forms(o));
  delete o.a;
  delete o.c;
  print(forms(o));
  o.a = 3;
  print(forms(o));
}
for (let round = 0;round < 3; round++)
  for (const keys of ["abc", "cba", "abc", "abc", "bca"])
    print(JSON.stringify(inOrder(keys)));

class Inherits extends WithToJSON {
  y = 2;
}

class Derived extends Plain {
  w = true;
}
for (const o of [new Plain, new WithMethods, new WithPrivate, new WithToJSON, new Inherits, new Derived, new WithKey, new OwnToJSON, new OwnCallable, new WithAccessor])
  print(forms(o));
print(forms({ f: () => 1, s: Symbol.iterator, u: undefined, n: 1 }) + " | " + forms({ big: 1n }) + " | " + forms({ d: new Date(0) }) + " | " + forms({ m: new Map([[1, 2]]), s: new Set([1]), r: /x/g, e: new Error("m") }) + " | " + forms({ n: new Number(5), s: new String("s"), b: new Boolean(false) }) + " | " + forms({ a: [undefined, () => 1, Symbol.iterator, null, [], {}] }));
{
  const o = { a: 1, b: 2 };
  o.extra = 3;
  o[5] = "index";
  o[Symbol.iterator] = 1;
  print(forms(o));
  const p = new Plain;
  p.extra = { deep: [1, { x: 2 }] };
  print(forms(p));
  Object.defineProperty(p, "hidden", { value: 1, enumerable: false });
  Object.defineProperty(p, "got", { get() {
    return "getter";
  }, enumerable: true });
  print(forms(p));
}
{
  const cycle = { a: 1 };
  cycle.self = cycle;
  print(forms(cycle));
  const inner = { v: 1 };
  const outer = { inner };
  inner.up = outer;
  print(forms(outer));
}
print(forms(Object.freeze({ a: 1, b: "s" })) + " | " + forms(Object.seal({ a: 1 })) + " | " + forms(Object.preventExtensions({ a: [1] })));
print(forms({ "key with space": 1, 'quote"': 2, "\xE9": 3, "\u65E5": 4, "": 5, "\n": 6, "0": 7, "-1": 8, "01": 9, __proto__x: 10 }));
let deep = 1;
for (let i = 0;i < 60; i++)
  deep = i & 1 ? { d: deep } : [deep];
print(forms(deep).length + " " + JSON.stringify(deep).slice(0, 80));
let tooDeep = 1;
for (let i = 0;i < 20000; i++)
  tooDeep = { d: tooDeep };
print(attempt(() => JSON.stringify(tooDeep).length));
const many = [];
for (let i = 0;i < 3000; i++)
  many.push({ a: i, b: [i, i + 1], c: { d: "s" + i }, e: null, f: (i & 1) === 0 });
print(JSON.stringify(many).length + " " + JSON.stringify(many, null, 1).length + " " + JSON.stringify(many.slice(2990)));
{
  const deleting = { first: null, second: 2, third: "3" };
  deleting.first = { toJSON() {
    delete deleting.second;
    return "deleted second";
  } };
  print(forms(deleting) + " " + Object.keys(deleting).join());
  const changing = { first: null, second: 2, third: "3" };
  changing.first = { toJSON() {
    changing.second = 22;
    changing.third = "33";
    return "changed";
  } };
  print(JSON.stringify(changing));
  const adding = { first: null, second: 2 };
  adding.first = { toJSON() {
    adding.third = "added";
    return "added third";
  } };
  print(JSON.stringify(adding) + " " + JSON.stringify(adding));
  const extra = { first: null, second: 2 };
  extra.first = { toJSON() {
    extra.more = "first extra property";
    return "added an extra";
  } };
  print(JSON.stringify(extra) + " " + JSON.stringify(extra));
  const again = { first: null, second: 2, third: "3" };
  again.first = { toJSON() {
    delete again.second;
    again.second = 222;
    return "deleted and created again";
  } };
  print(JSON.stringify(again) + " " + JSON.stringify(again));
  const byReplacer = { first: 1, second: 2, third: "3" };
  print(JSON.stringify(byReplacer, function(k, v) {
    if (k === "first") {
      delete byReplacer.third;
      byReplacer.late = 1;
    }
    return v;
  }) + " " + JSON.stringify(byReplacer));
  const byGetter = { first: 1, second: 2 };
  Object.defineProperty(byGetter, "mid", { enumerable: true, get() {
    delete byGetter.second;
    return "getter";
  } });
  byGetter.last = 9;
  print(JSON.stringify(byGetter));
}
print(JSON.stringify([{ x: 1, y: 2 }, { x: 3, y: 4 }]) + " " + JSON.stringify([JSON.parse("{}"), { x: 1, y: 2 }]) + " " + JSON.stringify({ p: { x: 1, y: 2 }, q: JSON.parse('{"z":1}') }));
print([JSON.stringify(mixed, ["a", "c", "d"]), JSON.stringify(mixed, (k, v) => typeof v === "number" ? v + 1 : v), JSON.stringify(mixed, null, 20), JSON.stringify(mixed, null, "0123456789abc"), JSON.stringify(mixed, null, 0), JSON.stringify(mixed, null, ""), JSON.stringify(mixed, undefined, 1.9), JSON.stringify(mixed, null, new Number(1)), JSON.stringify(mixed, [])].join(" | "));
print([JSON.stringify(undefined), JSON.stringify(null), JSON.stringify(1), JSON.stringify("s"), JSON.stringify(true), JSON.stringify([]), JSON.stringify({}), JSON.stringify(() => 1), JSON.stringify(Symbol.iterator)].map(show).join());
let sum = 0;
for (let i = 0;i < 20000; i++) {
  mixed.a = i;
  mixed.c.d = "v" + (i & 7);
  mixed.f = (i & 1) === 0;
  sum = (sum + JSON.stringify(mixed).length + JSON.stringify(inOrder(i & 1 ? "abc" : "cba")).length) % 1000003;
}
print(String(sum));
print(JSON.stringify(JSON.parse(JSON.stringify(mixed))) + " " + JSON.stringify(Object.assign({}, mixed)) + " " + JSON.stringify({ ...mixed, g: 1 }));

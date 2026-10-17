// Getters and setters written in object literals of untyped code: their attributes, pairs in either order, a name written twice, names that are indices, symbols, computed or `__proto__`, and literals made many times.
const describe = object => Reflect.ownKeys(object).map(key => { const d = Object.getOwnPropertyDescriptor(object, key); return String(key) + ":" + ("value" in d ? "value=" + JSON.stringify(d.value) + (d.writable ? "w" : "") : (d.get ? "get" : "") + (d.set ? "set" : "")) + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" ");
const seen = [];
function getter(i) { return { get x() { return i; } }; }
function setter(i) { return { set x(v) { seen.push(v + i); } }; }
function pair(i) { return { get x() { return i; }, set x(v) { i = v; } }; }
function pairReversed(i) { return { set x(v) { i = v; }, get x() { return i; } }; }
function pairApart(i) { return { get x() { return i; }, y: 1, set x(v) { i = v; }, z: 2 }; }
function amongNames(i) { return { a: i, get b() { return this.a + 1; }, c: i, get d() { return this.c + 2; }, set d(v) { this.c = v; } }; }
function getterTwice(i) { return { get x() { return "first"; }, get x() { return "second" + i; } }; }
function valueThenGetter(i) { return { x: i, get x() { return "getter"; } }; }
function getterThenValue(i) { return { get x() { return "getter"; }, x: i }; }
function getterValueSetter(i) { return { get x() { return "getter"; }, x: i, set x(v) {} }; }
function indexName(i) { return { get 0() { return i; }, set 1(v) {}, 2: i }; }
function symbolName(i) { return { get [Symbol.for("s")]() { return i; }, set [Symbol.for("s")](v) {} }; }
function computedName(k, i) { return { get [k]() { return i; }, a: 1, set [k + "2"](v) {} }; }
function protoName(i) { return { get __proto__() { return i; }, set __proto__(v) { seen.push("proto " + v); } }; }
function withProto(p, i) { return { __proto__: p, get x() { return i + this.up; } }; }
function behindSpread(r, i) { return { ...r, get a() { return i; } }; }
function aheadOfSpread(r, i) { return { get a() { return i; }, set b(v) {}, ...r }; }
function many(i) { return { get a() { return i; }, get b() { return i + 1; }, get c() { return i + 2; }, get d() { return i + 3; }, get e() { return i + 4; }, get f() { return i + 5; }, get g() { return i + 6; }, get h() { return i + 7; } }; }
function usesSuper(i) { return { __proto__: { get x() { return "base"; } }, get x() { return super.x + i; } }; }
for (let i = 0; i < 3; i++) {
  for (const [name, make] of Object.entries({ getter, setter, pair, pairReversed, pairApart, amongNames, getterTwice, valueThenGetter, getterThenValue, getterValueSetter, indexName, symbolName, protoName, many, usesSuper })) {
    const made = make(i);
    console.log(name, i, describe(made), "|", String(made.x), Object.getPrototypeOf(made) === Object.prototype, JSON.stringify(made));
  }
  console.log("computedName", describe(computedName("k" + i, i)), describe(computedName(i, i)));
  console.log("withProto", describe(withProto({ up: 10 }, i)), withProto({ up: 10 }, i).x);
  console.log("spreads", describe(behindSpread({ a: 1, b: 2 }, i)), "|", describe(aheadOfSpread({ a: 1, b: 2, c: 3 }, i)));
}
const p = pair(1); p.x = 5; console.log(p.x, pair(1).x); const q = pairApart(1); q.x = 7; console.log(q.x, Object.keys(q).join());
setter(1).x = 2; const named = protoName(3); named.__proto__ = "stored"; console.log(seen.join(), named.__proto__, Object.getPrototypeOf(named) === Object.prototype);
const g = Object.getOwnPropertyDescriptor(getter(1), "x").get, s = Object.getOwnPropertyDescriptor(setter(1), "x").set;
console.log(g.name, g.length, s.name, s.length, "prototype" in g, Object.getOwnPropertyDescriptor(getter(1), "x").get !== g, Object.getOwnPropertyDescriptor(pair(1), "x").set.name);
try { new g(); } catch (e) { console.log(e.name); }
const redefined = Object.defineProperty(getter(1), "x", { value: 9 }); console.log(describe(redefined)); delete redefined.x; console.log(describe(redefined));
let sum = 0; const kept = [];
for (let i = 0; i < 100000; i++) { const o = amongNames(i); o.d = i + 1; sum += o.b + o.d + many(i).h + pair(i).x; if (i % 25000 === 0) kept.push(o); }
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
console.log(sum, kept.map(o => o.b + ":" + o.d + ":" + describe(o)).join(" / "));

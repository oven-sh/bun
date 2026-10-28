// Object.getOwnPropertyDescriptor() on every kind of object and property, each queried twice.
const lines = [];
const show = d => d === undefined ? "undefined" : Reflect.ownKeys(d).map(k => k + "=" + (typeof d[k] === "function" ? "f:" + d[k].name : String(d[k]))).join();
const symbol = Symbol("s");
class Klass { static fixed = 1; static method() {} get got() { return 1; } set got(v) {} plain() {} #hidden = 1; field = 2; }
const holders = {
  literal: { a: 1, get b() { return 2; }, set b(v) {}, get c() { return 3; }, set d(v) {}, [symbol]: "sym", 7: "index" },
  frozen: Object.freeze({ a: 1 }), sealed: Object.seal({ a: 1 }), defined: Object.defineProperty({}, "a", { value: 1 }), hidden: Object.defineProperty({}, "a", { get() { return 1; }, enumerable: false, configurable: true }),
  array: [1, , 3], string: new String("ab"), fn: function named(x, y) {}, arrow: () => 1, klass: Klass, prototype: Klass.prototype, instance: new Klass(), bare: Object.create(null, { a: { value: 1, writable: true } }),
  inherits: Object.create({ a: "inherited" }), map: new Map(), error: new Error("m"), regexp: /x/g, args: (function () { return arguments; })(1, 2), big: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["k" + i, i])),
  proxy: new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { lines.push("the trap ran for " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } }),
};
const keys = ["a", "b", "c", "d", symbol, 7, "7", 0, 1, "length", "name", "prototype", "fixed", "method", "got", "plain", "field", "message", "stack2", "lastIndex", "k50", "missing", "constructor", "callee2"];
for (let round = 0; round < 2; round++)
  for (const h in holders)
    lines.push(round + " " + h + ": " + keys.map(k => show(Object.getOwnPropertyDescriptor(holders[h], k))).filter(t => t !== "undefined").join(" | "));
for (const primitive of ["text", 5, true, symbol, 10n]) lines.push(typeof primitive + ": " + show(Object.getOwnPropertyDescriptor(primitive, "length")) + " " + show(Object.getOwnPropertyDescriptor(primitive, 0)));
for (const nothing of [undefined, null]) { try { Object.getOwnPropertyDescriptor(nothing, "a"); lines.push("no throw"); } catch (e) { lines.push(e.constructor.name); } }
const d1 = Object.getOwnPropertyDescriptor(holders.literal, "a"), d2 = Object.getOwnPropertyDescriptor(holders.literal, "a");
d1.value = 9; d1.extra = true; lines.push(String(d1 !== d2) + " " + show(d2) + " " + holders.literal.a + " " + (Object.getPrototypeOf(d1) === Object.prototype) + " " + Object.isExtensible(d1));
lines.push(show(Object.getOwnPropertyDescriptor(holders.literal, { toString() { lines.push("the key was turned into a string"); return "a"; } })));
let sum = 0; for (let i = 0; i < 3000; i++) { const o = i & 1 ? { x: i } : { y: 1, x: i }; sum += Object.getOwnPropertyDescriptor(o, "x").value + (Object.getOwnPropertyDescriptor(o, "y") ? 1 : 0); } lines.push(String(sum));
console.log(lines.join("\n"));

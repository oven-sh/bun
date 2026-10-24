// `Object.assign({}, source)`: where the source is an ordinary object with nothing special about it, the new object is made in one piece with the shape of the source: no property is gone through, from the first copy of every shape on. A second source goes by a plan made once.
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const oneByOne = () => counted ? counted("operationAOTObjectAssignFrom") : 0;
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? JSON.stringify(d.value) ?? "undefined" : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(",");
const forms = { toNew(a) { return Object.assign({}, a); }, two(a, b) { return Object.assign({}, a, b); } };
const named = name => forms[[name][0]];
const toNew = named("toNew"), two = named("two");
const nine = JSON.parse('{"n0":0,"n1":1,"n2":2,"n3":3,"n4":4,"n5":5,"n6":6,"n7":7}'); nine.n8 = 8;
const makers = {
  parsed: () => JSON.parse('{"u0":0,"u1":"one","u2":[2]}'), literal: () => ({ l0: 0, l1: { deep: 1 } }), grown: () => { const o = { g0: 0 }; o.g1 = 1; o.g2 = 2; return o; }, nine: () => nine, empty: () => ({}),
  frozen: () => Object.freeze({ f0: 0, f1: 1 }), sealed: () => Object.seal({ s0: 0 }), closed: () => Object.preventExtensions({ c0: 0 }), hidden: () => Object.defineProperty({ h0: 0 }, "h1", { value: 1, enumerable: false }),
  getter: () => ({ a0: 0, get a1() { return "got"; } }), symbol: () => ({ y0: 0, [Symbol.for("s")]: 1 }), indexed: () => ({ i0: 0, 1: "one", 0: "zero" }), deleted: () => { const o = { d0: 0, d1: 1, d2: 2 }; delete o.d1; return o; },
  inheriting: () => Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true, writable: true, configurable: true } }), bare: () => Object.assign(Object.create(null), { b0: 0 }), instance: () => new (class Point { x = 1; y = 2; }),
  array: () => [1, 2], text: () => "ab", number: () => 5, nothing: () => undefined, none: () => null, callable: () => Object.assign(() => 0, { p: 1 }), underscore: () => JSON.parse('{"__proto__":{"polluted":1},"k":1}'),
};
for (let turn = 0; turn < 3; turn++) for (const name in makers) {
  const source = makers[name](), copy = toNew(source), both = two(source, makers.parsed());
  lines.push(turn + " " + name + " " + show(copy) + " | " + show(both) + " | " + (copy !== source) + " " + (Object.getPrototypeOf(copy) === Object.prototype) + " " + Object.isExtensible(copy) + " " + copy.polluted);
}
const original = makers.literal(), copied = toNew(original); copied.l0 = "changed"; copied.more = 1; lines.push(show(original) + " " + show(copied) + " " + (copied.l1 === original.l1));
let before = oneByOne(), sum = 0;
for (let i = 0; i < 2000; i++) sum += toNew(makers.parsed()).u0 + toNew(makers.literal()).l0 + toNew(makers.grown()).g2 + toNew(nine).n8;
lines.push(sum + " " + (oneByOne() - before));
before = oneByOne();
for (let i = 0; i < 300; i++) { const fresh = {}; fresh["k" + i] = i; fresh.last = 1; sum += toNew(fresh).last; }
lines.push(sum + " " + (oneByOne() - before));
console.log(lines.join("\n"));

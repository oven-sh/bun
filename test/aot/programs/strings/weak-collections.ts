// `WeakMap.prototype.get`, `WeakMap.prototype.has` and `WeakSet.prototype.has` are inlined and answer as the built-in functions do.
// CALLS- hasOf CallHostFunction
// CALLS- inSet CallHostFunction
// CALLS- getOfAnything CallHostFunction
function getOf(map: WeakMap<object, number>, key: object) { return map.get(key); }
function hasOf(map: WeakMap<object, number>, key: object) { return map.has(key); }
function inSet(set: WeakSet<object>, key: object) { return set.has(key); }
function getOfAnything(map: WeakMap<object, number>, key: any) { return map.get(key); }
function hasAnything(map: WeakMap<object, number>, key: any) { return map.has(key); }
function anythingInSet(set: WeakSet<object>, key: any) { return set.has(key); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function aroundACollection(map: WeakMap<object, number>, key: object) { const before = map.get(key); collect(); const behind = map.get(key); return before === behind && behind !== undefined; }
const table: any = { getOf, hasOf, inSet, getOfAnything, hasAnything, anythingInSet, aroundACollection };
const call = (name: string, ...given: any[]) => table[name](...given);

const empty = new WeakMap<object, number>(), emptySet = new WeakSet<object>(), one = {};
console.log("empty:", call("getOf", empty, one), call("hasOf", empty, one), call("inSet", emptySet, one));

const map = new WeakMap<object, number>(), set = new WeakSet<object>(), keys: object[] = [], others: object[] = [];
for (let i = 0; i < 1000; i++) { const key = i % 3 ? { i } : i % 2 ? [i] : () => i; keys.push(key); map.set(key, i); set.add(key); others.push({ i }); }
let sum = 0, had = 0, within = 0, strangers = 0;
for (const key of keys) { sum += call("getOf", map, key); had += call("hasOf", map, key) ? 1 : 0; within += call("inSet", set, key) ? 1 : 0; }
for (const key of others) strangers += (call("getOf", map, key) === undefined ? 0 : 1) + (call("hasOf", map, key) ? 1 : 0) + (call("inSet", set, key) ? 1 : 0);
console.log("a thousand keys:", sum, had, within, "strangers found:", strangers);

for (let i = 0; i < 1000; i += 2) { map.delete(keys[i]); set.delete(keys[i]); }
sum = 0; had = 0; within = 0;
for (const key of keys) { sum += call("getOf", map, key) ?? 0; had += call("hasOf", map, key) ? 1 : 0; within += call("inSet", set, key) ? 1 : 0; }
console.log("half of them deleted:", sum, had, within);
for (let i = 0; i < 1000; i += 2) { map.set(keys[i], -i); set.add(keys[i]); }
sum = 0;
for (const key of keys) sum += call("getOf", map, key);
console.log("and put back:", sum);

const local = Symbol("local");
(map as any).set(local, 77); (set as any).add(local);
for (const key of [1, 1.5, "text", "", null, undefined, true, 10n, Symbol.for("registered"), Symbol.iterator, local, NaN])
  console.log("a key that is", typeof key === "symbol" ? String(key) : typeof key + " " + String(key), call("getOfAnything", map, key), call("hasAnything", map, key), call("anythingInSet", set, key));
map.set(one, undefined as any);
console.log("undefined for a value:", call("getOf", map, one), call("hasOf", map, one));

class Answering extends WeakMap<object, number> { get(key: object) { return 42; } has(key: object) { return false; } }
class Plain extends WeakMap<object, number> {}
const answering = new Answering(), plain = new Plain(), altered = new WeakMap<object, number>();
answering.set(one, 1); plain.set(one, 2); altered.set(one, 3);
(altered as any).get = () => 7;
console.log("a class that answers itself:", call("getOf", answering, one), call("hasOf", answering, one), "· one that does not:", call("getOf", plain, one), call("hasOf", plain, one), "· a get of its own:", call("getOf", altered, one), call("hasOf", altered, one));
for (const wrong of [new Map(), new WeakSet(), {}, 1]) { try { console.log(WeakMap.prototype.get.call(wrong, one)); } catch (error: any) { console.log("on what is no WeakMap:", error.constructor.name); } }

const kept: object[] = [], crowded = new WeakMap<object, number>();
for (let i = 0; i < 100; i++) { const key = { i }; kept.push(key); crowded.set(key, i); }
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < 20000; i++) crowded.set({ i }, i);
  let held = 0;
  for (const key of kept) held += call("aroundACollection", crowded, key) ? 1 : 0;
  console.log("round", round, "kept keys found before and behind a collection:", held);
}

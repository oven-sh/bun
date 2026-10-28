// `WeakMap` names a class of the engine, and a place typed by it is tested for that class: it takes a WeakMap, undefined or null. Anything else throws a TypeError where it enters the place: a proxy or an heir of one, another class of the engine, a look-alike, a primitive.
// Places: a parameter, a variable, a field, a field of a class, a result, an element. undefined and null pass and meet JavaScript's own answer or error at the use.
// VALIDATED compiles
function claim<T>(v: unknown): T { return v as T }
function say(name: string, f: () => unknown): void {
  let said: string;
  try { said = String(f()) } catch (e) { said = "throws " + (e as Error).name }
  console.log(name + ": " + said);
}
const key = {};
class Holder { held: WeakMap<object, number>; constructor(held: WeakMap<object, number>) { this.held = held } }
function result(v: unknown): WeakMap<object, number> { return claim<WeakMap<object, number>>(v) }
function use0(v: WeakMap<object, number>): unknown { return v.get(key) }
function use1(v: WeakMap<object, number>): unknown { return v.has(key) }
function use2(v: WeakMap<object, number>): unknown { return (v.set(key, 2), v.get(key)) }
function use3(v: WeakMap<object, number>): unknown { return v instanceof WeakMap }
const values: [string, () => unknown][] = [
  ["the real thing", () => new WeakMap([[key, 1]])], ["a proxy of it", () => new Proxy(new WeakMap([[key, 1]]), {})], ["an heir of it", () => Object.create(new WeakMap([[key, 1]]))], ["another class of the engine", () => new Uint16Array([7, 8])],
  ["an array", () => [1, 2]], ["a look-alike", () => ({ get() { return 4 }, has() { return true }, set() { return this } })], ["a function", () => () => 1], ["a number", () => 5], ["a string", () => "text"], ["null", () => null], ["undefined", () => undefined],
];
for (const [name, make] of values) {
  say("a parameter, " + name + ", v.get(key)", () => use0(claim<WeakMap<object, number>>(make())));
  say("a variable, " + name + ", v.get(key)", () => { const v: WeakMap<object, number> = claim<WeakMap<object, number>>(make()); return v.get(key) });
  say("a field, " + name + ", v.get(key)", () => { const o: { v: WeakMap<object, number> } = { v: claim<WeakMap<object, number>>(make()) }; const v = o.v; return v.get(key) });
  say("a field of a class, " + name + ", v.get(key)", () => { const v = new Holder(claim<WeakMap<object, number>>(make())).held; return v.get(key) });
  say("a result, " + name + ", v.get(key)", () => { const v = result(make()); return v.get(key) });
  say("an element, " + name + ", v.get(key)", () => { const all: WeakMap<object, number>[] = [claim<WeakMap<object, number>>(make())]; const v = all[0]; return v.get(key) });
  say("a parameter, " + name + ", v.has(key)", () => use1(claim<WeakMap<object, number>>(make())));
  say("a variable, " + name + ", v.has(key)", () => { const v: WeakMap<object, number> = claim<WeakMap<object, number>>(make()); return v.has(key) });
  say("a field, " + name + ", v.has(key)", () => { const o: { v: WeakMap<object, number> } = { v: claim<WeakMap<object, number>>(make()) }; const v = o.v; return v.has(key) });
  say("a field of a class, " + name + ", v.has(key)", () => { const v = new Holder(claim<WeakMap<object, number>>(make())).held; return v.has(key) });
  say("a result, " + name + ", v.has(key)", () => { const v = result(make()); return v.has(key) });
  say("an element, " + name + ", v.has(key)", () => { const all: WeakMap<object, number>[] = [claim<WeakMap<object, number>>(make())]; const v = all[0]; return v.has(key) });
  say("a parameter, " + name + ", (v.set(key, 2), v.get(key))", () => use2(claim<WeakMap<object, number>>(make())));
  say("a variable, " + name + ", (v.set(key, 2), v.get(key))", () => { const v: WeakMap<object, number> = claim<WeakMap<object, number>>(make()); return (v.set(key, 2), v.get(key)) });
  say("a field, " + name + ", (v.set(key, 2), v.get(key))", () => { const o: { v: WeakMap<object, number> } = { v: claim<WeakMap<object, number>>(make()) }; const v = o.v; return (v.set(key, 2), v.get(key)) });
  say("a field of a class, " + name + ", (v.set(key, 2), v.get(key))", () => { const v = new Holder(claim<WeakMap<object, number>>(make())).held; return (v.set(key, 2), v.get(key)) });
  say("a result, " + name + ", (v.set(key, 2), v.get(key))", () => { const v = result(make()); return (v.set(key, 2), v.get(key)) });
  say("an element, " + name + ", (v.set(key, 2), v.get(key))", () => { const all: WeakMap<object, number>[] = [claim<WeakMap<object, number>>(make())]; const v = all[0]; return (v.set(key, 2), v.get(key)) });
  say("a parameter, " + name + ", v instanceof WeakMap", () => use3(claim<WeakMap<object, number>>(make())));
  say("a variable, " + name + ", v instanceof WeakMap", () => { const v: WeakMap<object, number> = claim<WeakMap<object, number>>(make()); return v instanceof WeakMap });
  say("a field, " + name + ", v instanceof WeakMap", () => { const o: { v: WeakMap<object, number> } = { v: claim<WeakMap<object, number>>(make()) }; const v = o.v; return v instanceof WeakMap });
  say("a field of a class, " + name + ", v instanceof WeakMap", () => { const v = new Holder(claim<WeakMap<object, number>>(make())).held; return v instanceof WeakMap });
  say("a result, " + name + ", v instanceof WeakMap", () => { const v = result(make()); return v instanceof WeakMap });
  say("an element, " + name + ", v instanceof WeakMap", () => { const all: WeakMap<object, number>[] = [claim<WeakMap<object, number>>(make())]; const v = all[0]; return v instanceof WeakMap });
}

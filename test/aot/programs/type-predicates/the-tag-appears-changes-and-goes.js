// Object.prototype.toString.call(x) on values nobody knows: the answer is asked many times, then Symbol.toStringTag appears, changes and goes: on the object, on the prototype of its class, two steps up, as a getter, as a value that is no string; on records, instances of classes, of constructor functions, lists, maps, dates, functions, errors, typed arrays, proxies, objects without a prototype.
const toString = Object.prototype.toString;
const box = { v: null };
function tag(x) { box.v = x; return toString.call(box.v); }
function many(x) { let last = ""; for (let i = 0; i < 300; i++) last = tag(x); return last; }
class Animal {} class Dog extends Animal {}
function Old() {} 
const subjects = {
  record: () => ({ a: 1 }), animal: () => new Animal(), dog: () => new Dog(), old: () => new Old(), list: () => [1], map: () => new Map(), date: () => new Date(0), fn: () => function () {}, arrow: () => () => 1,
  error: () => new Error("e"), bytes: () => new Uint8Array(1), bare: () => Object.create(null), under: () => Object.create({ a: 1 }), proxy: () => new Proxy({}, {}), proxyOfList: () => new Proxy([], {}), args: () => (function () { return arguments; })(),
  regexp: () => /a/, promise: () => Promise.resolve(1), set: () => new Set(), weak: () => new WeakMap(), symbolObject: () => Object(Symbol.iterator), numberObject: () => Object(1), textObject: () => Object("a"), booleanObject: () => Object(true), bigintObject: () => Object(1n), generator: () => (function* () {})(), global: () => globalThis,
};
for (const name in subjects) {
  const x = subjects[name](), line = [many(x)];
  try { x[Symbol.toStringTag] = "Own"; line.push(many(x)); x[Symbol.toStringTag] = 5; line.push(many(x)); delete x[Symbol.toStringTag]; line.push(many(x)); } catch (e) { line.push(e.name); }
  try { Object.defineProperty(x, Symbol.toStringTag, { get() { return "Got"; }, configurable: true }); line.push(many(x)); delete x[Symbol.toStringTag]; line.push(many(x)); } catch (e) { line.push(e.name); }
  console.log(name + ": " + line.join(" "));
}
const a = new Animal(), d = new Dog(), o = new Old(), r = { a: 1 };
console.log(many(a), many(d), many(o), many(r));
Animal.prototype[Symbol.toStringTag] = "Beast";
console.log(many(a), many(d), many(new Dog()), many(o), many(r));
Dog.prototype[Symbol.toStringTag] = "Hound";
console.log(many(a), many(d), many(new Dog()));
delete Animal.prototype[Symbol.toStringTag];
console.log(many(a), many(d));
delete Dog.prototype[Symbol.toStringTag];
console.log(many(a), many(d));
Old.prototype[Symbol.toStringTag] = "Elder";
console.log(many(o), many(new Old()));
Object.setPrototypeOf(o, Dog.prototype); Object.defineProperty(Animal.prototype, Symbol.toStringTag, { get() { return "By getter " + this.constructor.name; }, configurable: true });
console.log(many(o), many(a), many(d));
Object.setPrototypeOf(r, { [Symbol.toStringTag]: "Above" });
console.log(many(r), many({ a: 1 }));
for (const v of [undefined, null, 1, "a", true, 1n, Symbol.iterator]) console.log(many(v));
try { Error.prototype[Symbol.toStringTag] = "Failure"; console.log(many(new Error("e")), many(new TypeError("t"))); delete Error.prototype[Symbol.toStringTag]; console.log(many(new Error("e"))); } catch (e) { console.log(e.name); }

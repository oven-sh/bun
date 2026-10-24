// structuredClone and postMessage of typed objects: object literals, class instances, class prototypes, and what their fields hold. A copy is a plain object with the enumerable own properties that plain Bun copies, and what plain Bun cannot clone throws the same DataCloneError.
interface Flat { id: number; name: string; ok: boolean; none: null; missing: undefined; opt?: string }
interface Deep { id: number; inner: Flat; list: Flat[]; at?: Date }
class P { #hidden = 1; constructor(public x: number, public y: string) {} get sum() { return this.x + this.#hidden; } method() { return 1; } }
class Untouched { constructor(public v: number) {} method() { return this.v; } get twice() { return this.v * 2; } }
class OfInstance { method() { return 1; } }
class Base { inherited() { return 1; } }
class Derived extends Base { own() { return 2; } }
class Extended { method() { return 1; } }
class Repeated { method() { return 1; } }
class Posted { method() { return 1; } }
class Whole { method() { return 1; } }
class InField { method() { return 1; } }
class WithMethod { method() { return 1; } }
function* numbers() { yield 1; }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { const v = make(); out = Bun.inspect(v, { depth: 6, sorted: false }).replace(/\s+/g, " "); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const flat = (id: number): Flat => ({ id, name: "n" + id, ok: true, none: null, missing: undefined });
const facts = (v: any) => [v, Object.keys(v), Object.getPrototypeOf(v) === Object.prototype, Object.isExtensible(v)];
show("flat", () => facts(structuredClone(flat(1))));
show("flat, the optional field set", () => { const x = flat(1); x.opt = "o"; return facts(structuredClone(x)); });
show("flat, orders differ", () => { const x: { a?: number; b?: number } = {}; x.b = 2; x.a = 1; return facts(structuredClone(x)); });
show("the copy is another object", () => { const x = flat(1); const c = structuredClone(x); c.name = "changed"; return [x.name, c.name, c !== x]; });
show("numbers", () => structuredClone({ a: 1, b: 1.5, c: -0, d: NaN, e: Infinity, f: 2147483648, g: -2147483649 }));
show("strings: empty, a rope, 16-bit", () => structuredClone({ a: "", b: "left".repeat(5) + String(count), c: "значение", d: "\ud800" }));
show("deep", () => { const d: Deep = { id: 1, inner: flat(2), list: [flat(3), flat(4)] }; return structuredClone(d); });
show("deep with a Date", () => { const d: Deep = { id: 1, inner: flat(2), list: [], at: new Date(0) }; return structuredClone(d); });
show("an array of flat ones", () => structuredClone([flat(1), flat(2), flat(3)]));
show("an array of flat and plain and primitives", () => structuredClone([flat(1), JSON.parse('{"p":1}'), 1, "s", null, undefined, flat(2)]));
show("an array with one object twice", () => { const x = flat(1); const c = structuredClone([x, x]); return [c, c[0] === c[1]]; });
show("an array of deep ones", () => structuredClone([{ id: 1, inner: flat(2), list: [] } as Deep]));
show("an instance", () => facts(structuredClone(new P(1, "y"))));
show("an array of instances", () => structuredClone([new P(1, "a"), new P(2, "b")]).map(facts));
show("a cycle", () => { const x: { self?: unknown; v: number } = { v: 1 }; x.self = x; const c = structuredClone(x); return [c.self === c, c.v]; });
show("a function in a field", () => structuredClone({ f: () => 1, v: 1 }));
show("a symbol in a field", () => structuredClone({ s: Symbol("s"), v: 1 }));
show("a bigint in a field", () => structuredClone({ b: 10n, v: 1 }));
show("a map, a set, a typed array in fields", () => structuredClone({ m: new Map([[1, flat(1)]]), s: new Set([flat(2)]), t: new Uint8Array([1, 2]) }));
show("extras", () => { const x = flat(1); hide(x).extra = "e"; hide(x)[0] = "zero"; hide(x)[Symbol.for("s")] = 1; return facts(structuredClone(x)); });
show("an extra accessor", () => { const x = flat(1); Object.defineProperty(hide(x), "got", { get() { return "got " + this.id; }, enumerable: true }); return facts(structuredClone(x)); });
show("frozen, sealed", () => [structuredClone(Object.freeze(flat(1))), structuredClone(Object.seal(flat(2)))].map(facts));
show("another prototype, a null prototype", () => { const a = flat(1), b = flat(2); Object.setPrototypeOf(a, JSON.parse('{"inherited":1}')); Object.setPrototypeOf(b, null); return [structuredClone(a), structuredClone(b)].map(facts); });
show("empty", () => facts(structuredClone({} as { o?: number })));
show("a class's prototype that nothing has listed or written", () => facts(structuredClone(Untouched.prototype)));
show("the class afterwards", () => { const u = new Untouched(2); return [u.method(), u.twice, Object.getOwnPropertyNames(Untouched.prototype), Object.getPrototypeOf(u) === Untouched.prototype]; });
show("the same prototype again", () => facts(structuredClone(Untouched.prototype)));
show("the prototype of an instance, in a field", () => structuredClone({ p: Object.getPrototypeOf(new OfInstance()) }));
show("a derived class's prototype", () => facts(structuredClone(Derived.prototype)));
show("a class's prototype with an added property", () => { hide(Extended.prototype).extra = "e"; return facts(structuredClone(Extended.prototype)); });
show("an array with one class's prototype twice", () => { const c = structuredClone([Repeated.prototype, Repeated.prototype]); return [c, c[0] === c[1]]; });
show("a class", () => structuredClone(Whole));
show("a class in a field", () => structuredClone({ c: InField, v: 1 }));
show("a method of a class's prototype", () => structuredClone(WithMethod.prototype.method));
show("a generator", () => structuredClone(numbers()));
show("through a MessageChannel's serializer", () => { const { port1, port2 } = new MessageChannel(); port1.postMessage(flat(1)); port1.postMessage([flat(2), new P(1, "p")]); port1.postMessage(Posted.prototype); port1.close(); port2.close(); return "posted"; });

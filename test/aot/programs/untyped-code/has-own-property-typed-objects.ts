interface T { a?: number; b: number; c?: string; d?: unknown }
class Base { constructor(public v: number) {} method() { return 1; } get twice() { return this.v * 2; } }
class Heir extends Base { w = "w"; #secret = 1; peek() { return this.#secret; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make()); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const hasOwn = Object.prototype.hasOwnProperty;
const bits = (list: boolean[]) => list.map(b => (b ? "1" : "0")).join("");
const keys: any[] = ["a", "b", "c", "d", "zz", "toString", "constructor", "__proto__", "v", "w", "twice", "method", "#secret", "secret", "length", "0", 0, 1.5, "", Symbol.iterator, Symbol.for("s"), "a" + "", ["b"].join(""), { toString() { return "b"; } }, null, undefined];
function byCall(x: any) { return bits(keys.map(k => hasOwn.call(x, k))); }
function byMethod(x: any) { return typeof x.hasOwnProperty === "function" ? bits(keys.map(k => x.hasOwnProperty(k))) : "no method"; }
function byHasOwn(x: any) { return bits(keys.map(k => Object.hasOwn(x, k))); }
function enumerable(x: any) { return bits(keys.map(k => Object.prototype.propertyIsEnumerable.call(x, k))); }
function looped(x: any) { let n = 0; for (let i = 0; i < 50; i++) for (const k of keys) n += hasOwn.call(x, k) ? 1 : 0; return n; }
function owned(x: any) { const out: string[] = []; for (const k in x) if (hasOwn.call(x, k)) out.push(k); return out.join(); }
const every = (x: unknown) => [byCall(x), byMethod(x), byHasOwn(x), enumerable(x), looped(x), owned(x)];
const plain = (...list: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
const make: () => T = () => ({ b: 1 });
show("a record", () => every(make()));
show("optional fields: set, undefined, deleted", () => { const x: T = { a: 1, b: 1 }, y: T = { a: undefined, b: 1 }, z: T = { a: 1, b: 1 }; delete z.a; return [every(x), every(y), every(z)]; });
show("objects of one shape in turn, one site", () => { const list: T[] = [{ b: 1 }, { a: 1, b: 1 }, { b: 1 }, { b: 1, c: "c" }, { a: 1, b: 1, c: "c" }, { b: 1 }]; return list.map(byCall); });
show("set and deleted between looks", () => { const x = make(); const out = [every(x)]; x.a = 1; out.push(every(x)); delete x.a; out.push(every(x)); x.a = undefined; out.push(every(x)); return out; });
show("another prototype that has the names", () => { const proto = plain(["a", 9], ["zz", 9]); const x = Object.setPrototypeOf(hide(make()), proto); const out = [every(x)]; delete proto.a; out.push(every(x)); x.a = 1; out.push(every(x)); return out; });
show("a null prototype", () => every(Object.setPrototypeOf(hide(make()), null)));
show("instances", () => [every(new Base(1)), every(new Heir(2))]);
show("extras: a string, an index, a symbol, hidden, an accessor; then gone", () => { const x = make(); const out = [every(x)]; hide(x).zz = 1; out.push(every(x)); hide(x)[0] = 1; hide(x)[Symbol.for("s")] = 1; Object.defineProperty(hide(x), "length", { value: 1, enumerable: false }); Object.defineProperty(hide(x), "", { get() { return 1; }, enumerable: true, configurable: true }); out.push(every(x)); delete hide(x).zz; delete hide(x)[0]; delete hide(x)[""]; out.push(every(x)); return out; });
show("an extra that comes and goes", () => { const x = make(); hide(x).zz = 1; const a = byCall(x); delete hide(x).zz; return [a, byCall(x), every(x)]; });
show("frozen, sealed, closed", () => [Object.freeze({ a: 1, b: 1 } as T), Object.seal({ b: 2 } as T), Object.preventExtensions({ b: 3 } as T)].map(every));
show("typed and plain in turn, one site", () => [make(), plain(["b", 1]), { a: 1, b: 2 } as T, plain(["a", 1]), new Base(1), [1], make(), () => 1, "ab"].map(byCall));
show("a typed object as a prototype", () => { const proto = make(); const child = Object.create(proto); return [every(child), every(proto)]; });
show("a proxy over a typed object", () => byCall(new Proxy({ a: 1, b: 1 } as T, {})));
show("null and undefined", () => [null, undefined].map(x => { try { return byCall(x); } catch (e) { return (e as Error).name; } }));

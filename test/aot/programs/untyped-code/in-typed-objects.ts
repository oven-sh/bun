interface T { a?: number; b: number; c?: string; d?: unknown }
class Base { constructor(public v: number) {} method() { return 1; } get twice() { return this.v * 2; } }
class Heir extends Base { w = "w"; #secret = 1; static has(x: object) { return #secret in x; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make()); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const bits = (list: boolean[]) => list.map(b => (b ? "1" : "0")).join("");
function literal(x: any) { return bits(["a" in x, "b" in x, "c" in x, "d" in x, "zz" in x, "toString" in x, "constructor" in x, "__proto__" in x, "v" in x, "w" in x, "twice" in x, "method" in x, "length" in x, "0" in x, 0 in x, Symbol.iterator in x, Symbol.toStringTag in x]); }
const keys: (string | number | symbol)[] = ["a", "b", "c", "d", "zz", "toString", "constructor", "__proto__", "v", "w", "twice", "method", "length", "0", 0, Symbol.iterator, Symbol.toStringTag, "a" + "", ["b"].join(""), "x".repeat(3)];
function computed(x: any) { return bits(keys.map(k => k in x)); }
function looped(x: any) { let n = 0; for (let i = 0; i < 50; i++) for (const k of keys) n += k in x ? 1 : 0; return n; }
const every = (x: unknown) => [literal(x), computed(x), looped(x)];
const plain = (...list: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
show("a record", () => every({ b: 1 } as T));
show("optional fields: set, undefined, deleted", () => { const x: T = { a: 1, b: 1 }, y: T = { a: undefined, b: 1 }, z: T = { a: 1, b: 1 }; delete z.a; return [every(x), every(y), every(z)]; });
show("a required field deleted by untyped code", () => { const x: T = { b: 1 }; const first = every(x); try { delete hide(x).b; } catch (e) { return [first, (e as Error).name]; } return [first, every(x)]; });
show("objects of one shape in turn, one site", () => { const list: T[] = [{ b: 1 }, { a: 1, b: 1 }, { b: 1 }, { b: 1, c: "c" }, { a: 1, b: 1, c: "c" }, { b: 1 }]; return list.map(every); });
show("set and deleted between looks", () => { const x: T = { b: 1 }; const out = [every(x)]; x.a = 1; out.push(every(x)); delete x.a; out.push(every(x)); x.a = undefined; out.push(every(x)); return out; });
show("an absent field whose name the prototype has", () => { const x: T = { b: 1 }, y: T = { a: 1, b: 1 }; const proto = plain(["a", 9], ["zz", 9]); Object.setPrototypeOf(x, proto); Object.setPrototypeOf(y, proto); const out = [every(x), every(y)]; delete proto.a; delete proto.zz; out.push(every(x), every(y)); proto.c = 1; out.push(every(x)); return out; });
show("instances", () => [every(new Base(1)), every(new Heir(2)), Heir.has(new Heir(3)), Heir.has(new Base(4))]);
show("extras", () => { const x: T = { b: 1 }; const out = [every(x)]; hide(x).zz = 1; out.push(every(x)); hide(x)[0] = 1; hide(x)[Symbol.iterator] = 1; out.push(every(x)); delete hide(x).zz; out.push(every(x)); return out; });
show("frozen, sealed, closed", () => [Object.freeze({ a: 1, b: 1 } as T), Object.seal({ b: 2 } as T), Object.preventExtensions({ b: 3 } as T)].map(every));
show("a null prototype", () => every(Object.setPrototypeOf({ b: 1 } as T, null)));
show("a typed object as a prototype", () => { const proto: T = { b: 1 }; const child = Object.create(proto), typedChild: { zz: number } = { zz: 1 }; Object.setPrototypeOf(typedChild, proto); const out = [every(child), every(typedChild)]; proto.a = 1; out.push(every(child), every(typedChild)); delete proto.a; out.push(every(child), every(typedChild)); return out; });
show("typed and plain in turn, one site", () => [{ b: 1 } as T, plain(["b", 1]), { a: 1, b: 2 } as T, plain(["a", 1]), new Base(1), [1], { b: 3 } as T, () => 1].map(every));
show("a proxy over a typed object", () => every(new Proxy({ a: 1, b: 1 } as T, {})));
show("not objects", () => [1, "ab", null, undefined].map(x => { try { return literal(x); } catch (e) { return (e as Error).name; } }));

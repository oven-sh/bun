interface T { a?: number; b: number; c?: string; d?: unknown }
interface Numbers { i: number; f: number; z: number; n: number; big: number; neg: number }
class Base { constructor(public v: number) {} method() { return 1; } get twice() { return this.v * 2; } }
class Heir extends Base { w = "w"; #secret = 1; get secret() { return this.#secret; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => v === undefined ? "undefined" : typeof v === "number" && (v !== v || Object.is(v, -0) || !isFinite(v)) ? "number " + (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : v); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function values(x: any) { return Object.values(x); }
function looped(x: any) { const out: unknown[] = []; for (const v of Object.values(x)) out.push(v); return out; }
function counted(x: any) { return Object.values(x).length; }
const every = (x: unknown) => [values(x), looped(x), counted(x), Object.keys(x as object)];
const plain = (...list: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
show("a record", () => every({ b: 1 } as T));
show("optional fields: set, undefined, deleted", () => { const x: T = { a: 1, b: 1 }, y: T = { a: undefined, b: 1 }, z: T = { a: 1, b: 1 }; delete z.a; return [every(x), every(y), every(z)]; });
show("objects of one shape in turn, one site", () => { const list: T[] = [{ b: 1 }, { a: 1, b: 1 }, { b: 1 }, { b: 1, c: "c" }, { a: 1, b: 1, c: "c" }, { b: 1 }]; return list.map(values); });
show("orders differ", () => { const x: T = { b: 1 }, y: T = { b: 1 }; x.a = 1; x.c = "c"; y.c = "c"; y.a = 1; return [every(x), every(y)]; });
show("a field set after the first look", () => { const x: T = { b: 1 }; const first = every(x); x.a = 5; const second = every(x); delete x.a; return [first, second, every(x)]; });
show("numbers", () => every({ i: 1, f: 1.5, z: -0, n: NaN, big: 2147483648, neg: -2147483649 } as Numbers));
show("values of every kind, and they are the same things", () => { const inner: T = { b: 2 }, f = () => 1, s = Symbol("s"), list = [1]; const x: T = { b: 1, d: inner }; const y = { p: null, q: true, r: "s", s: f, t: s, u: list, v: 10 }; const got = values(y); return [every(x), values(x)[1] === inner, got[3] === f, got[4] === s, got[5] === list, got.length]; });
show("instances", () => [every(new Base(1)), every(new Heir(2))]);
show("extras: a string, an index, a symbol, hidden, an accessor", () => { const x: T = { b: 1 }; hide(x).zz = 1; const one = every(x); hide(x)[0] = "zero"; const two = every(x); hide(x)[Symbol.for("s")] = 2; Object.defineProperty(hide(x), "hidden", { value: 1, enumerable: false }); Object.defineProperty(hide(x), "got", { get() { return "got " + this.b; }, enumerable: true }); return [one, two, every(x)]; });
show("an extra that is deleted again", () => { const x: T = { b: 1 }; hide(x).zz = 1; delete hide(x).zz; return every(x); });
show("frozen, sealed, closed", () => [Object.freeze({ a: 1, b: 1 } as T), Object.seal({ b: 2 } as T), Object.preventExtensions({ b: 3 } as T)].map(every));
show("another prototype, a null prototype", () => [Object.setPrototypeOf(hide({ b: 1 } as T), plain(["zz", 1], ["a", 2])), Object.setPrototypeOf(hide({ b: 2 } as T), null)].map(x => [values(x), looped(x)]));
show("empty", () => [every({} as { o?: number }), every({ o: undefined } as { o?: number })]);
show("typed and plain in turn, one site", () => [{ b: 1 } as T, plain(["b", 1]), { a: 1, b: 2 } as T, plain(["zz", 1]), new Base(1), [1, 2], "ab", { b: 3 } as T, 5, true].map(values));
show("what comes back is fresh and ordinary", () => { const x: T = { a: 1, b: 2 }; const e = values(x), f = values(x); e[0] = "changed"; e.push("more"); return [e, f, x, e !== f, Array.isArray(e), Object.getPrototypeOf(f) === Array.prototype, Object.isFrozen(f)]; });
show("null and undefined", () => [null, undefined].map(x => { try { return values(x); } catch (e) { return (e as Error).name; } }));
show("many fields", () => every({ f01: 1, f02: 2, f03: 3, f04: 4, f05: 5, f06: 6, f07: 7, f08: 8, f09: 9, f10: 10, f11: 11, f12: 12, f13: 13, f14: 14, f15: 15, f16: 16, f17: 17, f18: 18, f19: 19, f20: 20 }));
show("many objects", () => { let n = 0; for (let i = 0; i < 3000; i++) { const x: T = i & 1 ? { a: i, b: i, c: "c" + i } : { b: i }; n += counted(x) + (values(x)[0] as number); } return n; });

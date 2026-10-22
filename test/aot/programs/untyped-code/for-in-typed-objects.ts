// `for (key in x)` in code that knows nothing of x, where x is an object of a type of the program: the keys, their order, what is read by them, and what happens to the object while the loop runs. The last line counts: once the list for a key order is known, the loop does not enter the runtime for it.
declare const aotOperationCount: undefined | ((name: string) => number);
interface T { a?: number; b: number; c?: string; d?: unknown }
interface Wide { f01: number; f02: number; f03: number; f04: number; f05: number; f06: number; f07: number; f08: number; f09: number; f10: number; f11: number; f12: number }
class Base { constructor(public v: number) {} method() { return 1; } get twice() { return this.v * 2; } }
class Heir extends Base { w = "w"; #secret = 1; get secret() { return this.#secret; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => v === undefined ? "undefined" : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : v); } catch (e) { out = "throws " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function keys(x: any) { const out: string[] = []; for (const key in x) out.push(key); return out; }
function pairs(x: any) { const out: unknown[] = []; for (const key in x) out.push(key, x[key]); return out; }
function copy(x: any) { const out: any = {}; for (const key in x) out[key] = x[key]; return out; }
function own(x: any) { const out: string[] = []; for (const key in x) if (Object.prototype.hasOwnProperty.call(x, key)) out.push(key); return out; }
function isEmpty(x: any) { for (const key in x) return false; return true; }
function nested(x: any, y: any) { const out: string[] = []; for (const p in x) for (const q in y) out.push(p + q); return out; }
const every = (x: unknown) => [keys(x), pairs(x), copy(x), own(x), isEmpty(x)];
const plain = (...list: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
show("a record", () => every({ b: 1 } as T));
show("optional fields: set, undefined, deleted", () => { const x: T = { a: 1, b: 1 }, y: T = { a: undefined, b: 1 }, z: T = { a: 1, b: 1 }; delete z.a; return [every(x), every(y), every(z)]; });
show("objects of one shape in turn, one site", () => { const list: T[] = [{ b: 1 }, { a: 1, b: 1 }, { b: 1 }, { b: 1, c: "c" }, { a: 1, b: 1, c: "c" }, { b: 1 }]; return list.map(keys); });
show("orders differ", () => { const x: T = { b: 1 }, y: T = { b: 1 }; x.a = 1; x.c = "c"; y.c = "c"; y.a = 1; return [every(x), every(y), every({ c: "c", b: 1, a: 1 } as T)]; });
show("a field set after the first look", () => { const x: T = { b: 1 }; const first = every(x); x.a = 5; const second = every(x); delete x.a; return [first, second, every(x)]; });
show("instances", () => [every(new Base(1)), every(new Heir(2))]);
show("extras: a string, an index, a symbol, hidden, an accessor", () => { const x: T = { b: 1 }; hide(x).zz = 1; const one = every(x); hide(x)[0] = "zero"; const two = every(x); hide(x)[Symbol.for("s")] = 2; Object.defineProperty(hide(x), "hidden", { value: 1, enumerable: false }); Object.defineProperty(hide(x), "got", { get() { return "got"; }, enumerable: true }); return [one, two, every(x)]; });
show("an extra that is deleted again", () => { const x: T = { b: 1 }; hide(x).zz = 1; delete hide(x).zz; return every(x); });
show("frozen, sealed, closed", () => [Object.freeze({ a: 1, b: 1 } as T), Object.seal({ b: 2 } as T), Object.preventExtensions({ b: 3 } as T)].map(every));
show("another prototype, a null prototype", () => [Object.setPrototypeOf(hide({ b: 1 } as T), plain(["zz", 1], ["a", 2])), Object.setPrototypeOf(hide({ b: 2 } as T), null), Object.setPrototypeOf(hide({ a: 1, b: 3 } as T), { a: 9, b: 9, c: "inherited" } as T)].map(every));
show("a typed object as the prototype of a plain one", () => { const x: T = { a: 1, b: 2 }; const heir = Object.create(hide(x)); heir.own = 1; heir.b = 3; return every(heir); });
show("empty", () => [every({} as { o?: number }), every({ o: undefined } as { o?: number })]);
show("typed and plain in turn, one site", () => [{ b: 1 } as T, plain(["b", 1]), { a: 1, b: 2 } as T, plain(["zz", 1]), new Base(1), [1, 2], "ab", { b: 3 } as T, 5, true, null, undefined, plain()].map(keys));
show("a field is deleted ahead of its turn", () => { const x: T = { a: 1, b: 2, c: "c" }; const out: string[] = []; for (const key in hide(x)) { out.push(key); delete x.c; } return [out, keys(x)]; });
show("a field is deleted and set again ahead of its turn", () => { const x: T = { a: 1, b: 2, c: "c" }; const out: unknown[] = []; for (const key in hide(x)) { out.push(key, hide(x)[key]); if (key === "a") { delete x.c; x.c = "again"; } } return [out, keys(x)]; });
show("a field is set while the loop runs", () => { const x: T = { b: 2 }; const out: string[] = []; for (const key in hide(x)) { out.push(key); x.a = 1; x.c = "c"; } return [out, keys(x)]; });
show("an extra comes while the loop runs", () => { const x: T = { a: 1, b: 2 }; const out: unknown[] = []; for (const key in hide(x)) { out.push(key, hide(x)[key]); hide(x).zz = 1; } return [out, keys(x)]; });
show("values change while the loop runs", () => { const x: T = { a: 1, b: 2, c: "c" }; const out: unknown[] = []; for (const key in hide(x)) { out.push(key, hide(x)[key]); x.b = 20; x.c = "later"; } return out; });
show("the prototype changes while the loop runs", () => { const x: T = { a: 1, b: 2 }; const out: unknown[] = []; for (const key in hide(x)) { out.push(key, hide(x)[key]); Object.setPrototypeOf(hide(x), plain(["zz", 1])); } return [out, keys(x)]; });
show("a prototype that was given gets a name, loses it, and hides one", () => { const x: T = { a: 1, b: 2 }, proto = plain(); Object.setPrototypeOf(hide(x), proto); const before = keys(x); proto.listed = 1; const during = [keys(x), own(x), pairs(x)]; delete proto.listed; const after = keys(x); Object.defineProperty(proto, "hidden", { value: 1, enumerable: false }); proto.b = 9; return [before, during, after, keys(x), pairs(x)]; });
show("the prototype of a prototype that was given gets a name", () => { const x: T = { a: 1, b: 2 }, far = plain(), near = Object.create(far); Object.setPrototypeOf(hide(x), near); const before = keys(x); far.listed = 1; const during = keys(x); near.closer = 2; return [before, during, keys(x)]; });
show("loops within loops", () => nested({ a: 1, b: 2 } as T, { b: 1, c: "c" } as T));
show("the list is nobody else's", () => { const x: T = { a: 1, b: 2 }; const first = keys(x); first.push("more"); first[0] = "changed"; return [first, keys(x), Object.keys(x)]; });
show("many fields", () => every({ f01: 1, f02: 2, f03: 3, f04: 4, f05: 5, f06: 6, f07: 7, f08: 8, f09: 9, f10: 10, f11: 11, f12: 12 } as Wide));
show("many objects", () => { let n = 0; for (let i = 0; i < 3000; i++) { const x: T = i & 1 ? { a: i, b: i, c: "c" + i } : { b: i }; n += keys(x).length + (pairs(x)[1] as number); } return n; });
const counted = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const one: T = { a: 1, b: 2, c: "c" }, other = new Base(1);
let total = keys(one).length + keys(other).length;
const before = counted("operationAOTForInKeys");
for (let i = 0; i < 1000; i++) total += keys(one).length + keys(other).length;
console.log(total, counted("operationAOTForInKeys") - before < 100);

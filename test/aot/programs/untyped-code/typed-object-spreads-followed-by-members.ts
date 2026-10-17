// `{ ...x, name: value }` in code that knows nothing of x, where x is an object of a type of the program: the keys and their order, what is overwritten, and that the copy is an ordinary object of its own.
interface T { a?: number; b: number; c?: string; d?: unknown }
interface Six { f1: number; f2: string; f3: boolean; f4: number; f5: string | null; f6: { v: number } }
interface Wide { g01: number; g02: number; g03: number; g04: number; g05: number; g06: number; g07: number; g08: number; g09: number; g10: number; g11: number; g12: number }
class Base { constructor(public v: number) {} method() { return 1; } get twice() { return this.v * 2; } }
class Heir extends Base { w = "w"; #secret = 1; get secret() { return this.#secret; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => v === undefined ? "undefined" : typeof v === "number" && (v !== v || Object.is(v, -0)) ? "number " + (Object.is(v, -0) ? "-0" : "NaN") : typeof v === "function" ? "function" : v); } catch (e) { out = "throws " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function one(x: any) { return { ...x, more: 1 }; }
function two(x: any) { return { ...x, more: 1, again: "2" }; }
function three(x: any) { return { ...x, more: 1, again: "2", third: null }; }
function over(x: any) { return { ...x, b: "over" }; }
function overAndMore(x: any) { return { ...x, more: 1, b: "over" }; }
function twice(x: any) { return { ...x, more: 1, ...x, b: 2 }; }
function ahead(x: any) { return { first: 0, ...x, more: 1 }; }
function later(x: any) { const copy: any = { ...x, more: 1 }; copy.later = 2; copy.evenLater = 3; return copy; }
function computed(x: any, key: string) { return { ...x, [key]: 1 }; }
const forms = [one, two, three, over, overAndMore, twice, ahead, later];
const every = (x: unknown) => forms.map(f => { const made = f(x); return [Object.keys(made).join(), made]; });
const plain = (...list: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
const six = (): Six => ({ f1: 1, f2: "2", f3: true, f4: 4.5, f5: null, f6: { v: 6 } });
show("a record", () => every({ b: 1 } as T));
show("six fields: the copy has no room left", () => every(six()));
show("twelve fields", () => every({ g01: 1, g02: 2, g03: 3, g04: 4, g05: 5, g06: 6, g07: 7, g08: 8, g09: 9, g10: 10, g11: 11, g12: 12 } as Wide));
show("optional fields: set, undefined, deleted", () => { const x: T = { a: 1, b: 1 }, y: T = { a: undefined, b: 1 }, z: T = { a: 1, b: 1 }; delete z.a; return [every(x), every(y), every(z)]; });
show("orders differ", () => { const x: T = { b: 1 }, y: T = { b: 1 }; x.a = 1; x.c = "c"; y.c = "c"; y.a = 1; return [one(x), one(y), over(x), over(y), one({ c: "c", b: 1, a: 1 } as T)].map(o => [Object.keys(o).join(), o]); });
show("objects of one shape in turn, one site", () => { const list: T[] = [{ b: 1 }, { a: 1, b: 1 }, { b: 1 }, { b: 1, c: "c" }, { a: 1, b: 1, c: "c" }, { b: 1 }]; return list.map(x => Object.keys(two(x)).join()); });
show("numbers", () => one({ g01: 1, g02: 1.5, g03: -0, g04: NaN, g05: 2147483648, g06: -2147483649, g07: 1073741824, g08: 0, g09: 0, g10: 0, g11: 0, g12: 0 } as Wide));
show("the values are the same things, the copy is its own", () => { const x = six(), made = one(x); made.f1 = "changed"; made.more = 5; delete made.f2; return [made.f6 === x.f6, x, made, Object.getPrototypeOf(made) === Object.prototype, Object.isExtensible(made), Object.isFrozen(made)]; });
show("instances", () => [every(new Base(1)), every(new Heir(2))]);
show("extras: a string, an index, a symbol, hidden, an accessor", () => { const x: T = { b: 1 }; hide(x).zz = 1; const first = every(x); hide(x)[0] = "zero"; hide(x)[Symbol.for("s")] = 2; Object.defineProperty(hide(x), "hidden", { value: 1, enumerable: false }); Object.defineProperty(hide(x), "got", { get() { return "got"; }, enumerable: true }); const made = one(x); return [first, every(x), made[Symbol.for("s")], Object.getOwnPropertyDescriptor(made, "got")]; });
show("an extra that is deleted again", () => { const x: T = { b: 1 }; hide(x).zz = 1; delete hide(x).zz; return every(x); });
show("frozen, sealed, closed: the copy is none of it", () => [Object.freeze({ a: 1, b: 1 } as T), Object.seal({ b: 2 } as T), Object.preventExtensions({ b: 3 } as T)].map(x => { const made = later(x); return [made, Object.isFrozen(made), Object.isSealed(made), Object.isExtensible(made)]; }));
show("another prototype, a null prototype", () => [Object.setPrototypeOf(hide({ b: 1 } as T), plain(["zz", 1], ["a", 2])), Object.setPrototypeOf(hide({ b: 2 } as T), null)].map(x => { const made = one(x); return [made, Object.getPrototypeOf(made) === Object.prototype]; }));
show("typed and plain and what is no object in turn, one site", () => [{ b: 1 } as T, plain(["b", 1]), six(), plain(["zz", 1]), new Base(1), [1, 2], "ab", { b: 3 } as T, 5, true, null, undefined, plain()].map(x => Object.keys(two(x)).join()));
show("computed names", () => { const x = six(); return ["more", "f1", "f6", "0", "__proto__"].map(key => { const made = computed(x, key); return [Object.keys(made).join(), made[key] === 1, Object.getPrototypeOf(made) === Object.prototype]; }); });
show("empty", () => [every({} as { o?: number }), every({ o: undefined } as { o?: number })]);
show("many objects, garbage between", () => { let n = 0, kept: unknown; for (let i = 0; i < 3000; i++) { const x: T = i & 1 ? { a: i, b: i, c: "c" + i } : { b: i }; kept = { i }; const made = two(x); n += Object.keys(made).length + made.b + made.more; } return [n, kept !== undefined]; });

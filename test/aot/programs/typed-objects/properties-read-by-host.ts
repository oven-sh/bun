import { inspect, isDeepStrictEqual } from "node:util";
interface Row { id: number; name: string; note?: string; score?: number }
type Init = { status?: number; statusText?: string; headers?: Record<string, string> };
type Format = { minimumFractionDigits?: number; maximumFractionDigits?: number; style?: "decimal" | "percent"; useGrouping?: boolean };
type DateFormat = { year?: "numeric"; month?: "long" | "short"; day?: "numeric"; timeZone?: string };
type Descriptor = { value?: unknown; writable?: boolean; enumerable?: boolean; configurable?: boolean; get?: () => unknown };
type Handler = { get?: (target: object, key: string | symbol) => unknown; has?: (target: object, key: string | symbol) => boolean };
type ArrayLike3 = { length: number };
type InspectOptions = { depth?: number; compact?: boolean; sorted?: boolean };
class Base { constructor(public v: number) {} method() { return "method " + this.v; } get twice() { return this.v * 2; } static made = 1; }
class Heir extends Base { w = 5; own() { return "own"; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : v); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const row = (id: number): Row => ({ id, name: "n" + id });
const names: (string | symbol | number)[] = ["id", "name", "note", "score", "nope", "toString", "constructor", "__proto__", "0", "1.5", "-1", "4294967295", "", "length", 0, 7, Symbol.iterator, Symbol.toStringTag, Symbol("mine")];
const reads = (x: unknown) => names.map(n => { const v = hide(x); return [Reflect.get(v, n), Reflect.has(v, n), Object.hasOwn(v, n), v.hasOwnProperty(n), v.propertyIsEnumerable(n), Reflect.getOwnPropertyDescriptor(v, n)]; });
show("every name on a record", () => reads(row(1)));
show("with the optional fields set", () => { const x = row(1); x.note = "note"; x.score = 1.5; return reads(x); });
show("an optional field undefined, deleted", () => { const x = row(1), y = row(2); x.note = undefined; y.note = "n"; delete y.note; return [reads(x), reads(y)]; });
show("with extras", () => { const x = row(1); hide(x).nope = "extra"; hide(x)[0] = "zero"; hide(x)[Symbol.toStringTag] = "Tag"; return reads(x); });
show("an extra accessor", () => { const x = row(1); Object.defineProperty(hide(x), "nope", { get() { return "got " + this.id; }, configurable: true }); return reads(x); });
show("instances", () => [reads(new Base(1)), reads(new Heir(2))]);
show("inherited: a method, an accessor with its receiver, a static", () => { const h = hide(new Heir(3)); return [Reflect.get(h, "method").call(h), Reflect.get(h, "twice"), Reflect.get(h, "twice", { v: 50 }), Reflect.get(h, "own").call(h), Reflect.get(h, "made"), Reflect.has(h, "method"), Reflect.has(h, "twice"), Object.hasOwn(h, "twice")]; });
show("an absent optional field whose name the prototype has", () => { const proto = JSON.parse('{"note":"from the prototype","nope":"also"}'); const x = row(1), y = row(2); Object.setPrototypeOf(x, proto); Object.setPrototypeOf(y, proto); y.note = "own"; return [reads(x), reads(y)]; });
show("a prototype with an index and a symbol", () => { const proto = JSON.parse('{"0":"zero","7":"seven"}'); proto[Symbol.toStringTag] = "P"; const x = row(1); Object.setPrototypeOf(x, proto); return reads(x); });
show("a null prototype", () => { const x = row(1); Object.setPrototypeOf(x, null); return names.map(n => [Reflect.get(x, n), Reflect.has(x, n), Object.hasOwn(x, n)]); });
show("a typed object as a prototype", () => { const proto = row(1); proto.note = "typed above"; const child = Object.create(proto), typedChild = row(2); Object.setPrototypeOf(typedChild, proto); return [reads(child), reads(typedChild)]; });
show("a proxy over a typed object", () => { const p = new Proxy(row(1), {}); return names.map(n => [Reflect.get(p, n), Reflect.has(p, n)]); });
show("frozen, sealed, closed", () => [Object.freeze(row(1)), Object.seal(row(2)), Object.preventExtensions(row(3))].map(reads));
show("isFrozen, isSealed, isExtensible", () => { const e: { o?: number } = {}; const withExtra = row(9); hide(withExtra).extra = 1; const list: unknown[] = [row(1), Object.preventExtensions(row(2)), Object.seal(row(3)), Object.freeze(row(4)), e, Object.preventExtensions({} as { o?: number }), Object.seal({} as { o?: number }), withExtra, Object.freeze(withExtra), new Base(1), Object.freeze(new Heir(2))]; return list.map(x => [Object.isFrozen(x), Object.isSealed(x), Object.isExtensible(x)]); });
show("closed, then its only field deleted", () => { const x: { o?: number } = { o: 1 }; Object.preventExtensions(x); const before = [Object.isFrozen(x), Object.isSealed(x)]; delete x.o; return [before, Object.isFrozen(x), Object.isSealed(x)]; });
show("new Response(body, typed)", () => { const a: Init = { status: 201, statusText: "made" }, b: Init = {}, c: Init = { headers: { "x-a": "1" } }; return [a, b, c].map(i => { const r = new Response("b", i); return [r.status, r.statusText, r.headers.get("x-a")]; }); });
show("Intl.NumberFormat(locale, typed)", () => { const a: Format = { minimumFractionDigits: 2 }, b: Format = { style: "percent", maximumFractionDigits: 1 }, c: Format = { useGrouping: false }; return [a, b, c, {} as Format].map(o => new Intl.NumberFormat("en-US", o).format(1234.5678)); });
show("toLocaleDateString(locale, typed)", () => { const a: DateFormat = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }, b: DateFormat = { month: "short", timeZone: "UTC" }; return [a, b].map(o => new Date(86400000).toLocaleDateString("en-US", o)); });
show("Object.defineProperty(o, k, typed)", () => { const a: Descriptor = { value: 1, enumerable: true }, b: Descriptor = { get: () => "got", configurable: true }, c: Descriptor = {}; return [a, b, c].map(d => Object.getOwnPropertyDescriptor(Object.defineProperty({}, "k", d), "k")); });
show("Object.defineProperties(o, typed)", () => { const all: { a: Descriptor; b: Descriptor } = { a: { value: 1, enumerable: true }, b: { value: 2 } }; return Object.getOwnPropertyDescriptors(Object.defineProperties({}, all)); });
show("new Proxy(target, typed)", () => { const h: Handler = { get: (_t, k) => "trapped " + String(k) }, none: Handler = {}, has: Handler = { has: () => true }; const t = { a: 1 }; return [hide(new Proxy(t, h)).a, hide(new Proxy(t, none)).a, "zz" in new Proxy(t, has), "zz" in new Proxy(t, none)]; });
show("a typed handler that gets a trap late", () => { const h: Handler = {}; const p = hide(new Proxy({ a: 1 }, h)); const out = [p.a, p.a]; h.get = () => "late"; out.push(p.a); delete h.get; out.push(p.a); return out; });
show("Array.from(typed array-like)", () => { const a: ArrayLike3 = { length: 2 }; hide(a)[0] = "x"; hide(a)[1] = "y"; return [Array.from(hide(a)), Array.prototype.slice.call(a, 1), Array.prototype.join.call(a, "-")]; });
show("inspect(value, typed)", () => { const o: InspectOptions = { depth: 0, compact: true }, s: InspectOptions = { sorted: true }; return [inspect({ b: { c: 1 }, a: 1 }, o), inspect({ b: 1, a: 2 }, s)]; });
show("isDeepStrictEqual", () => [isDeepStrictEqual(row(1), row(1)), isDeepStrictEqual(row(1), row(2)), isDeepStrictEqual(row(1), { id: 1, name: "n1" }), isDeepStrictEqual(new Base(1), new Base(1)), isDeepStrictEqual(new Base(1), new Heir(1))]);
show("instanceof, isPrototypeOf, getPrototypeOf", () => { const h = new Heir(1); return [hide(h) instanceof Base, Base.prototype.isPrototypeOf(h), Object.getPrototypeOf(h) === Heir.prototype, Object.getPrototypeOf(row(1)) === Object.prototype]; });
show("with (typed) in sloppy code", () => new Function("o", "with (o) { return [id, name, typeof note, typeof nope]; }")(row(1)));
show("destructuring in code the build cannot see", () => new Function("o", "const { id, name, note = 'default', nope = 'none', ...rest } = o; return [id, name, note, nope, rest];")(row(1)));

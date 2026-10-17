#!/usr/bin/env python3
"""array-from-subclasses-and-native-setters.py <folder>: ONE CASE A FOLDER: programs pointed at: Array.from of a Map, a string or an iterator of entries . heirs of Array that are iterated . JSON.stringify of fresh literals . native setters, also one that throws . fields of typed objects read by name in JavaScript."""
import os, sys

out = sys.argv[1]
cases = {}
H = """const say = f => { try { const v = f(); return typeof v === 'string' ? JSON.stringify(v) : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? '[' + Array.from({ length: Math.min(v.length, 10) }, (x, i) => i in v ? (Array.isArray(v[i]) ? '(' + v[i].join('/') + ')' : String(v[i])) : '-').join() + ']#' + v.length : String(v); } catch (e) { return 'THROWS ' + e.name; } };
const line = (name, ...fs) => console.log(name + ': ' + fs.map(say).join(' | '));
"""

cases["array-from"] = {"main.js": H + """function from(x) { return Array.from(x); }
function fromMapped(x, f) { return Array.from(x, f); }
function fromThis(x, f, t) { return Array.from(x, f, t); }
for (let i = 0; i < 300; i++) { from(new Map([[1, 2]])); from('ab'); from(new Map([[1, 2]]).entries()); from(new Set([1])); from([1, 2]); fromMapped('ab', c => c + c); }
const sources = { map: () => new Map([[1, 'a'], [2, 'b']]), emptyMap: () => new Map(), mapEntries: () => new Map([[1, 'a']]).entries(), keysOfMap: () => new Map([[1, 'a'], [2, 'b']]).keys(), valuesOfMap: () => new Map([[1, 'a']]).values(), set: () => new Set([3, 4]), entriesOfSet: () => new Set([3]).entries(), setValues: () => new Set([3]).values(),
  string: () => 'abc', empty: () => '', wide: () => 'a\\u0416\\u{1F600}b', lone: () => '\\uD83Dx\\uDE00', rope: () => 'ab'.repeat(3) + 'c', boxed: () => new String('xy'), array: () => [1, 2, 3], holes: () => [1, , 3], arrayEntries: () => ['p', 'q'].entries(), arrayKeys: () => [7, 8].keys(), typed: () => new Uint8Array([5, 6]), typedEntries: () => new Uint8Array([5]).entries(), args: () => (function () { return arguments; })(1, 2),
  like: () => ({ length: 2, 0: 'x', 1: 'y' }), likeText: () => ({ length: '2', 0: 'x' }), likeNegative: () => ({ length: -1 }), likeFraction: () => ({ length: 1.9, 0: 'x', 1: 'y' }), likeHuge: () => ({ length: 2 ** 53 }), none: () => ({}), number: () => 5, nil: () => null, undef: () => undefined, bool: () => true, symbol: () => Symbol.iterator, fn: () => function (a, b) {},
  generator: () => (function* () { yield 1; yield 2; })(), objectEntries: () => Object.entries({ a: 1, b: 2 }), formData: () => { const f = new FormData(); f.append('k', 'v'); return f; }, headers: () => new Headers({ a: 'b' }), params: () => new URLSearchParams('a=1&b=2'), matchAll: () => 'a1b2'.matchAll(/\\d/g), segmented: () => new Intl.Segmenter('en').segment('ab'),
  ownIterator: () => ({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n++ > 1, value: n }) }; } }), iteratorNull: () => ({ [Symbol.iterator]: null, length: 1, 0: 'like' }), iteratorNotCallable: () => ({ [Symbol.iterator]: 5 }), heirOfMap: () => new (class extends Map { *[Symbol.iterator]() { yield 'mine'; } })([[1, 2]]), heirOfMapPlain: () => new (class extends Map {})([[1, 2]]), mapWithOwnIterator: () => Object.assign(new Map([[1, 2]]), { [Symbol.iterator]: function* () { yield 'own'; } }), stringObjectOwn: () => Object.assign(new String('ab'), { [Symbol.iterator]: function* () { yield 'own'; } }), proxyOfMap: () => new Proxy(new Map([[1, 2]]), {}), proxyOfArray: () => new Proxy([1, 2], {}), usedIterator: () => { const it = new Map([[1, 'a'], [2, 'b']]).entries(); it.next(); return it; }, doneIterator: () => { const it = new Set([1]).values(); it.next(); it.next(); return it; } };
for (const [name, make] of Object.entries(sources)) line(name, () => from(make()), () => fromMapped(make(), (v, i) => i + ':' + String(v)), () => fromThis(make(), function (v) { return this.tag + String(v); }, { tag: 't' }), () => [...make()], () => Array.from(make()).length);
line('each pair is new', () => { const m = new Map([[1, 'a']]); const a = from(m), b = from(m); a[0][1] = 'changed'; return [b[0][1], m.get(1), a[0] === b[0]].join(); }, () => { const a = from(new Map([[{}, []]])); return Array.isArray(a[0]) + ':' + a[0].length + Object.isFrozen(a[0]); });
line('changed on the way', () => { const m = new Map([[1, 1], [2, 2]]); return fromMapped(m, ([k]) => { if (k === 1) { m.delete(2); m.set(3, 3); } return k; }); }, () => { const s = new Set([1, 2]); return fromMapped(s, v => { if (v < 4) s.add(v + 2); return v; }); }, () => { const a = [1, 2, 3]; return fromMapped(a, v => { if (v === 1) a.length = 2; return v; }); }, () => { const a = [1]; return fromMapped(a, v => { if (a.length < 4) a.push(v + 1); return v; }); });
line('the mapper', () => fromMapped('ab', 5), () => fromMapped('ab', null), () => fromMapped('ab', undefined), () => fromMapped(null, 5), () => fromMapped('ab', () => { throw new RangeError('x'); }), () => { let closed = 0; const it = { [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return() { closed++; return {}; } }; } }; try { fromMapped(it, () => { throw new Error('x'); }); } catch (e) {} return closed; });
line('another constructor', () => { class S extends Array {} return S.from('ab') instanceof S; }, () => { class S extends Array {} return S.from(new Map([[1, 2]])).length; }, () => JSON.stringify(Array.from.call(Object, 'ab')), () => JSON.stringify(Array.from.call(function () { return { marker: 1 }; }, new Map([[1, 2]]))), () => Array.from.call(undefined, 'ab'), () => Array.from.call(Object.freeze, 'a'), () => { function C() { Object.defineProperty(this, 0, { value: 'fixed', writable: false, configurable: false }); } return Array.from.call(C, 'a'); }, () => { const f = Array.from; return f('ab'); });
"""}

cases["heirs-of-array-iterated"] = {"main.js": H + """class Plain extends Array {}
class OwnIterator extends Array { *[Symbol.iterator]() { yield 'mine'; } }
class OwnValues extends Array { values() { return ['values laid over'][Symbol.iterator](); } }
class Getter extends Array { get 0() { return 'class getter'; } }
class Length extends Array { get length() { return 1; } set length(v) {} }
class Deep extends Plain {}
function each(a) { const r = []; for (const x of a) r.push(x); return r; }
function spread(a) { return [...a]; }
function destructure(a) { const [x, y = 'dflt', ...rest] = a; return [x, y, rest.length]; }
function args(a) { return Math.max(...a); }
for (let i = 0; i < 300; i++) { each(Plain.from([1, 2])); spread(Deep.of(1)); destructure(Plain.of(1, 2, 3)); each([1]); }
const makers = { plain: () => Plain.from([1, 2, 3]), deep: () => Deep.of(4, 5), empty: () => new Plain(), holes: () => { const a = new Plain(3); a[1] = 'm'; return a; }, ownIterator: () => OwnIterator.from([1, 2]), valuesOfItsOwn: () => OwnValues.from([1, 2]), getter: () => Getter.of(), lengthLaidOver: () => { const a = new Length(); a.push; return a; }, instanceIterator: () => Object.assign(Plain.of(1, 2), { [Symbol.iterator]: function* () { yield 'instance'; } }), protoMoved: () => Object.setPrototypeOf(Plain.of(1, 2), { [Symbol.iterator]: function* () { yield 'moved'; } }), protoNull: () => Object.setPrototypeOf(Plain.of(1), null), frozen: () => Object.freeze(Plain.of(1, 2)), sparse: () => { const a = new Plain(); a[1000] = 1; return a; }, accessorElement: () => Object.defineProperty(Plain.of(1, 2), 1, { get() { return 'got'; } }), proxy: () => new Proxy(Plain.of(1, 2), {}), es5: () => { function E() {} E.prototype = Object.create(Array.prototype); const e = new E(); e.push(1, 2); return e; }, reflect: () => Reflect.construct(Array, [1, 2], Plain), doubles: () => Plain.of(0.5, 1.5) };
for (const [name, make] of Object.entries(makers)) line(name, () => each(make()), () => spread(make()), () => destructure(make()), () => args(make()), () => Array.from(make()), () => new Set(make()).size, () => { const [a] = make(); return a; });
line('changed on the way', () => { const a = Plain.of(1, 2, 3); const r = []; for (const x of a) { r.push(x); if (x === 1) a.length = 2; } return r; }, () => { const a = Plain.of(1); const r = []; for (const x of a) { r.push(x); if (a.length < 4) a.push(x + 1); } return r; }, () => { const a = Plain.of(1, 2, 3); const r = []; for (const x of a) { r.push(x); if (x === 1) Object.setPrototypeOf(a, OwnIterator.prototype); } return r; }, () => { const a = Plain.of(1, 2); const r = []; for (const x of a) { r.push(x); a[1] = 'stored'; } return r; });
line('the class changes later', () => { class L extends Array {} for (let i = 0; i < 200; i++) each(L.of(1)); L.prototype[Symbol.iterator] = function* () { yield 'late'; }; return each(L.of(1, 2)); }, () => { class M extends Array {} for (let i = 0; i < 200; i++) spread(M.of(1)); Object.setPrototypeOf(M.prototype, { [Symbol.iterator]: function* () { yield 'reparented'; } }); return spread(M.of(1, 2)); }, () => { class N extends Array {} for (let i = 0; i < 200; i++) each(N.of(1)); Object.defineProperty(N.prototype, 0, { get() { return 'hole filled by the class'; }, configurable: true }); return each(new N(2)); });
"""}

cases["json-of-fresh-literals"] = {"main.ts": """const say = (f: () => unknown): string => { try { return String(f()); } catch (e) { return "THROWS " + (e as Error).name; } };
const line = (name: string, ...fs: (() => unknown)[]): void => console.log(name + ": " + fs.map(say).join(" | "));
const any = (v: unknown): any => v;
function a1(id: number, name: string): string { return JSON.stringify({ id, name }); }
function a2(id: number, ok: boolean, note: string | undefined): string { return JSON.stringify({ id, ok, note, fixed: "f", n: null, list: [id, id + 1], inner: { ok, id } }); }
function a3(v: unknown): string { return JSON.stringify({ v }); }
function a4(k: string, v: number): string { return JSON.stringify({ [k]: v, k }); }
function a5(o: { a: number }): string { return JSON.stringify({ ...o, b: 2 }); }
function a6(x: number): string { return JSON.stringify({ x, get y() { return x + 1; }, z() { return 1; }, [Symbol.iterator]: 1, toString: 5 }); }
function a7(x: number): string { return JSON.stringify({ x, toJSON() { return { replaced: x }; } }); }
function a8(x: number): string { return JSON.stringify({ x, x2: x }, null, 2); }
function a9(x: number): string { return JSON.stringify({ x, y: x }, ["y"]); }
function a10(x: number): string { return JSON.stringify({ x, y: "s" }, (k, v) => typeof v === "number" ? v * 2 : v); }
function a11(d: Date, r: RegExp, m: Map<number, number>): string { return JSON.stringify({ d, r, m, e: new Error("x"), u8: new Uint8Array([1]), big: [undefined, () => 1, Symbol()] }); }
function a12(x: number): string { return JSON.stringify({ 1: x, 0: "zero", b: 1, "-1": "m", a: 2 }); }
function a13(x: number): string { return JSON.stringify({ a: 1, [String("a")]: x }); }
function a14(x: number): string { return JSON.stringify({ __proto__: { up: 1 }, x } as any); }
function a15(x: number): string { return JSON.stringify({ ["__proto__"]: x, y: 1 }); }
function a16(x: number): string { const o = { x, later: 0 }; o.later = x + 1; return JSON.stringify(o); }
function a17(x: number): string { const o = { x }; any(o).added = 1; delete any(o).x; return JSON.stringify(o); }
function a18(s: string): string { return JSON.stringify({ s, [s]: s }); }
for (let i = 0; i < 300; i++) { a1(i, "n"); a2(i, !!(i & 1), i & 2 ? "x" : undefined); a3(i); a4("k", i); a5({ a: i }); a8(i); a16(i); }
line("plain", () => a1(1, "n"), () => a1(-0, ""), () => a1(NaN, "\\"\\\\\\n\\u2028\\u0416\\uD83D"), () => a1(1e21, "\\u0000"), () => a1(0.1 + 0.2, "x".repeat(3)), () => a2(1, true, undefined), () => a2(2, false, "note"));
line("any value", ...[1, "s", null, undefined, true, 1.5, -0, NaN, Infinity, [], {}, [undefined], () => 1, Symbol("s"), new Date(0), new Number(3), new String("b"), new Boolean(false), Object.create(null), new Map(), /x/, new Proxy({ p: 1 }, {}), new Proxy([1], {}), { toJSON() { return "T"; } }, { toJSON: 5 }].map(v => () => a3(v)), () => a3(1n), () => { const c: any = {}; c.c = c; return a3(c); });
line("keys", () => a4("k", 1), () => a4("z", 1), () => a4("", 1), () => a4("__proto__", 1), () => a4("0", 1), () => a4("toJSON", 1), () => a12(9), () => a13(2), () => a14(1), () => a15(1), () => a18("k"), () => a18("s"), () => a18("\\""));
line("forms", () => a5({ a: 1 }), () => a5(any({ a: 1, b: 9, c: 3 })), () => a5(any(null)), () => a5(any("ab")), () => a6(1), () => a7(1), () => a8(1), () => a9(1), () => a10(1), () => a11(new Date(0), /x/g, new Map([[1, 1]])), () => a16(1), () => a17(1));
line("the world changes", () => { const keep = (Date.prototype as any).toJSON; try { (Date.prototype as any).toJSON = () => "patched"; return a3(new Date(0)); } catch (e) { return (e as Error).name; } finally { try { (Date.prototype as any).toJSON = keep; } catch {} } }, () => { try { (Object.prototype as any).toJSON = () => "every object"; return a1(1, "n"); } catch (e) { return (e as Error).name; } finally { try { delete (Object.prototype as any).toJSON; } catch {} } }, () => { const real = JSON.stringify; try { (JSON as any).stringify = () => "mine"; return a1(1, "n"); } catch (e) { return (e as Error).name; } finally { try { (JSON as any).stringify = real; } catch {} } });
"""}

cases["native-setters"] = {"main.js": H + """function setHref(u, v) { u.href = v; return u.href; }
function setSearch(u, v) { u.search = v; return u.href; }
function setLastIndex(r, v) { r.lastIndex = v; return r.lastIndex; }
function setProto(o, p) { o.__proto__ = p; return Object.getPrototypeOf(o) === p; }
function setLength(a, v) { a.length = v; return a.length; }
function setOn(w, f) { w.onmessage = f; return w.onmessage === f; }
function putTitle(v) { process.title = v; return typeof process.title; }
function setStack(e, v) { e.stack = v; return e.stack; }
function setExit(v) { process.exitCode = v; const r = process.exitCode; process.exitCode = undefined; return r; }
for (let i = 0; i < 300; i++) { setHref(new URL('http://a/'), 'http://b/' + (i & 3)); setSearch(new URL('http://a/'), '?q=' + i); setLastIndex(/x/g, i & 7); setProto({}, Array.prototype); setStack(new Error('e'), 's'); }
line('url', () => setHref(new URL('http://a/'), 'http://c/d?e#f'), () => setHref(new URL('http://a/'), 'not a url'), () => setHref(new URL('http://a/'), { toString() { return 'http://t/'; } }), () => setHref(new URL('http://a/'), Symbol.iterator), () => setHref(new URL('http://a/'), { toString() { throw new RangeError('x'); } }), () => setSearch(new URL('http://a/p'), 'x=1'), () => setSearch(new URL('http://a/p?z'), ''), () => setSearch(new URL('http://a/p'), null), () => setSearch(new URL('http://a/p'), undefined), () => setHref({ href: 'own' }, 'plain object'), () => setHref(Object.create(new URL('http://a/')), 'http://heir/'), () => setHref(URL.prototype, 'http://p/'), () => { class U extends URL { set href(v) { super.href = 'http://heir' + v.length + '/'; } get href() { return super.href; } } return setHref(new U('http://a/'), 'abc'); }, () => { const u = new URL('http://a/'); Object.defineProperty(u, 'href', { value: 'laid over', writable: true }); return setHref(u, 'stored'); }, () => { 'use strict'; const u = Object.freeze(new URL('http://a/')); return setHref(u, 'http://frozen/'); });
line('the setter is replaced', () => { const d = Object.getOwnPropertyDescriptor(URL.prototype, 'search'); const log = []; try { Object.defineProperty(URL.prototype, 'search', { get: d.get, set(v) { log.push(v); }, configurable: true }); setSearch(new URL('http://a/'), 'seen'); return log.join(); } finally { Object.defineProperty(URL.prototype, 'search', d); } }, () => setSearch(new URL('http://a/'), 'back'), () => { const d = Object.getOwnPropertyDescriptor(URL.prototype, 'search'); try { Object.defineProperty(URL.prototype, 'search', { get: d.get, set: undefined, configurable: true }); return setSearch(new URL('http://a/?keep'), 'ignored'); } finally { Object.defineProperty(URL.prototype, 'search', d); } }, () => { const d = Object.getOwnPropertyDescriptor(URL.prototype, 'search'); try { delete URL.prototype.search; const u = new URL('http://a/'); u.search = 'own now'; return Object.keys(u).join() + u.href; } finally { Object.defineProperty(URL.prototype, 'search', d); } });
line('others', () => setLastIndex(/x/g, 3), () => setLastIndex(/x/g, 'text'), () => setLastIndex(Object.freeze(/x/g), 3), () => setProto({}, null), () => setProto({}, 5), () => setProto(Object.preventExtensions({}), {}), () => setProto(Object.create(null), {}), () => { const a = {}, b = Object.create(a); return setProto(a, b); }, () => setProto(5, {}), () => setProto(null, {}), () => setLength([1, 2, 3], 1), () => setLength([], -1), () => setLength(new Uint8Array(2), 5), () => setStack(new Error('e'), 'mine'), () => setStack(new Error('e'), undefined), () => setStack({}, 'plain'), () => putTitle('t'), () => setExit(3), () => setExit('4'), () => setExit('x'), () => setExit(1.5), () => { const c = new MessageChannel(); const r = setOn(c.port1, () => 1); c.port1.close(); c.port2.close(); return r; }, () => { const c = new MessageChannel(); const r = setOn(c.port1, 5); c.port1.close(); c.port2.close(); return r; });
"""}

cases["typed-fields-read-by-name-in-javascript"] = {"main.ts": """import { read, readAll, write, keysOf, hot } from "./plain.js";
const say = (f: () => unknown): string => { try { const v = f(); return typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v); } catch (e) { return "THROWS " + (e as Error).name; } };
const line = (name: string, ...fs: (() => unknown)[]): void => console.log(name + ": " + fs.map(say).join(" | "));
interface Rec { n: number; i: number; b: boolean; ob?: boolean; on?: number; s: string; nn: number | null; u: number | undefined; o: { x: number } }
class K { n = 1.5; i = 2; b = true; ob?: boolean; on?: number; s = "k"; }
const recs: Rec[] = [{ n: 0.5, i: 1, b: true, s: "a", nn: null, u: undefined, o: { x: 1 } }, { n: -0, i: -1, b: false, ob: false, on: 0, s: "", nn: 0, u: 5, o: { x: -0 } }, { n: NaN, i: 2147483647, b: true, ob: true, on: NaN, s: "\\u0416", nn: 1e300, u: -1, o: { x: 1e-7 } }, { n: Infinity, i: 2147483648, b: false, ob: undefined, on: undefined, s: "z", nn: -Infinity, u: 0.1, o: { x: 4294967296 } }];
const names = ["n", "i", "b", "ob", "on", "s", "nn", "u", "o", "missing", "toString", "constructor", "__proto__"];
hot(recs, names); hot([new K()], names);
for (const r of recs) console.log(names.map(k => say(() => { const v = read(r, k); return v !== null && typeof v === "object" ? JSON.stringify(v) : typeof v === "function" ? "fn" : v; })).join(" "), "|", say(() => readAll(r)), "|", say(() => keysOf(r)));
line("a class", () => readAll(new K()), () => keysOf(new K()), () => read(new K(), "ob"), () => read(new K(), "n"));
line("typeof", ...names.slice(0, 9).map(k => () => typeof read(recs[1]!, k)));
line("written from JavaScript", () => { const r = { ...recs[0]! }; write(r, "n", 7); return r.n; }, () => { const r = { ...recs[0]! }; write(r, "b", false); return r.b; }, () => { const r = { ...recs[0]! }; write(r, "ob", true); return r.ob + keysOf(r); }, () => { const r = { ...recs[0]! }; write(r, "n", "text"); return typeof r.n; }, () => { const r = { ...recs[0]! }; write(r, "b", 1); return typeof r.b; }, () => { const r = { ...recs[0]! }; write(r, "on", undefined); return keysOf(r); }, () => { const r = { ...recs[0]! }; write(r, "extra", 1); return keysOf(r); }, () => { const r = { ...recs[0]! }; write(r, "i", 0.5); return r.i; }, () => { const r = { ...recs[0]! }; write(r, "i", -0); return Object.is(r.i, -0); });
line("kept", () => { const r: Rec = { ...recs[1]! }; const seen = read(r, "n"); r.n = 9; return String(Object.is(seen, -0)) + read(r, "n"); }, () => JSON.stringify(recs[1]) === readAll(recs[1]!), () => Object.keys(recs[3]!).join() === keysOf(recs[3]!));
""", "plain.js": """export function read(o, k) { return o[k]; }
export function readN(o) { return o.n; } export function readB(o) { return o.b; } export function readOb(o) { return o.ob; }
export function readAll(o) { return JSON.stringify([o.n, o.i, o.b, o.ob, o.on, o.s, o.nn, o.u, Object.is(o.n, -0), typeof o.b, typeof o.ob, o.b === true, o.b === false, o.ob === undefined, o.n === o.n]); }
export function write(o, k, v) { o[k] = v; }
export function keysOf(o) { return Object.keys(o).join(); }
export function hot(list, names) { let s = 0; for (let r = 0; r < 200; r++) for (const o of list) { for (const k of names) s += typeof o[k] === 'number' ? 1 : 0; s += readN(o) === 1 ? 1 : 0; s += readB(o) ? 1 : 0; s += readOb(o) ? 1 : 0; readAll(o); } return s; }
"""}

for name, files in cases.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for f, text in files.items():
        with open(os.path.join(out, name, f), "w") as h:
            h.write(text)
print(len(cases), "cases")

#!/usr/bin/env python3
"""frozen-arrays-namespaces-out-of-bounds.py <folder>: ONE CASE A FOLDER: programs pointed at: frozen arrays . arrays made by a length of unknown type . reads past the end of a string or a typed array . exports read off a namespace object . JSON.stringify of optional members . reads by name at a guessed place . a key that is the same symbol on every way."""
import os, sys

out = sys.argv[1]
cases = {}
H = """const say = f => { try { const v = f(); return typeof v === 'string' ? JSON.stringify(v) : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? '[' + Array.from({ length: Math.min(v.length, 8) }, (x, i) => i in v ? String(v[i]) : '-').join() + ']#' + v.length : String(v); } catch (e) { return 'THROWS ' + e.name; } };
const line = (name, ...fs) => console.log(name + ': ' + fs.map(say).join(' | '));
"""

# ---- fz2b
cases["frozen-arrays"] = {"main.cjs": H + """const makers = { ints: () => [1, 2, 3], doubles: () => [1.5, 2.5], mixed: () => [1, 'a', null, undefined, {}], holes: () => [1, , 3], empty: () => [], nested: () => [[1], [2]], long: () => Array.from({ length: 100 }, (_, i) => i), sparse: () => { const a = [1]; a[5000] = 2; return a; }, literalTwice: () => { const f = () => [7, 8, 9]; f(); return f(); }, withName: () => Object.assign([1, 2], { extra: 'x' }), accessor: () => Object.defineProperty([1, 2, 3], 1, { get() { return 'got'; }, enumerable: true, configurable: true }) };
const sloppy = { store: a => { a[0] = 9; return a; }, storePast: a => { a[a.length] = 9; return a; }, length: a => { a.length = 0; return a; }, del: a => [delete a[0], a[0]].join(), name: a => { a.n = 1; return a.n; } };
const strict = { store: a => { 'use strict'; a[0] = 9; return a; } };
const methods = { push: a => a.push(1), pop: a => a.pop(), shift: a => a.shift(), unshift: a => a.unshift(0), splice: a => a.splice(0, 1), spliceNothing: a => a.splice(0, 0), sort: a => a.sort(), sortOne: a => a.slice(0, 1).sort(), reverse: a => a.reverse(), fill: a => a.fill(0), fillNothing: a => a.fill(0, 0, 0), copyWithin: a => a.copyWithin(0, 1), pushNothing: a => a.push(),
  slice: a => a.slice(), concat: a => a.concat([9]), map: a => a.map(x => x), filter: a => a.filter(() => true), spread: a => [...a], from: a => Array.from(a), toSorted: a => a.toSorted(), toReversed: a => a.toReversed(), toSpliced: a => a.toSpliced(0, 1), withAt: a => a.with(0, 5), flat: a => a.flat(), join: a => a.join(), indexOf: a => a.indexOf(2), includes: a => a.includes(undefined), at: a => a.at(-1), keys: a => Object.keys(a).join(), entries: a => JSON.stringify(Object.entries(a).slice(0, 3)), json: a => JSON.stringify(a).slice(0, 60), reduce: a => a.reduce((s, x) => s + String(x), ''), forIn: a => { let s = ''; for (const k in a) s += k; return s.slice(0, 20); }, forOf: a => { let s = ''; for (const x of a) s += String(x); return s.slice(0, 20); }, destructure: a => { const [x, y, ...r] = a; return [x, y, r.length].join(); }, apply: a => Math.max.apply(null, a), clone: a => Object.isFrozen(structuredClone(a.filter(x => typeof x !== 'object' || x === null))) };
const states = { isFrozen: a => Object.isFrozen(a), isSealed: a => Object.isSealed(a), isExtensible: a => Object.isExtensible(a), descriptor0: a => JSON.stringify(Object.getOwnPropertyDescriptor(a, 0)), descriptorLength: a => JSON.stringify(Object.getOwnPropertyDescriptor(a, 'length')), define: a => Object.defineProperty(a, 0, { value: 5 }), defineSame: a => Object.defineProperty(a, 0, { value: a[0] }) === a, reflectSet: a => Reflect.set(a, 0, 5), reflectDefine: a => Reflect.defineProperty(a, 9, { value: 1 }), reflectDelete: a => Reflect.deleteProperty(a, 0), setProto: a => Object.setPrototypeOf(a, null), setSameProto: a => Object.setPrototypeOf(a, Array.prototype) === a, freezeAgain: a => Object.freeze(a) === a, assign: a => Object.assign(a, [5]), isArray: a => Array.isArray(a) };
for (let i = 0; i < 300; i++) { const a = Object.freeze([1, 2, 3]); sloppy.store(a); methods.at(a); methods.indexOf(a); methods.forOf(a); }
for (const [name, make] of Object.entries(makers)) for (const [group, table] of Object.entries({ sloppy, strict, methods, states })) console.log(name, group, Object.entries(table).map(([k, f]) => k + '=' + say(() => f(Object.freeze(make())))).join(' '));
line('inside stays free', () => { const a = Object.freeze([{ n: 1 }, [1]]); a[0].n = 2; a[1].push(2); return JSON.stringify(a); });
line('frozen late', () => { const a = [1, 2, 3]; const read = () => a[0] + a.length; const before = read(); a[0] = 5; Object.freeze(a); a[0] = 9; return before + ',' + read(); }, () => { const a = [1, 2, 3]; const it = a.values(); it.next(); Object.freeze(a); return JSON.stringify(it.next()); }, () => { const a = [3, 1, 2]; try { a.sort((x, y) => { Object.freeze(a); return x - y; }); } catch (e) { return e.name + a.join(); } return a.join(); });
line('sealed and closed', () => { const a = Object.seal([1, 2]); a[0] = 9; a[2] = 3; return a; }, () => Object.seal([1, 2]).push(3), () => Object.seal([1, 2]).pop(), () => { const a = Object.preventExtensions([1, 2]); a[0] = 9; delete a[1]; a[1] = 5; return a; }, () => Object.preventExtensions([1, 2]).push(3), () => Object.isFrozen(Object.preventExtensions([])), () => Object.isFrozen(Object.seal([])), () => Object.isFrozen(Object.preventExtensions([1])));
line('as a constant of the module', () => TABLE[1] + TABLE.length, () => { TABLE[1] = 'changed'; return TABLE[1]; }, () => TABLE.map(x => x + 1), () => lookup(2), () => lookup(5), () => lookup(-1), () => lookup('1'), () => lookup('length'));
var TABLE = Object.freeze([10, 20, 30]); function lookup(i) { return TABLE[i]; }
line('again, now it is made', () => TABLE[1] + TABLE.length, () => { TABLE[1] = 'changed'; return TABLE[1]; }, () => lookup(2), () => lookup(5), () => lookup(-1), () => lookup('1'), () => lookup('length'), () => { for (let i = 0; i < 300; i++) lookup(i % 4); return lookup(0); });
class Sub extends Array {} line('subclass, arguments, typed', () => Object.freeze(Sub.from([1, 2])).map(x => x) instanceof Sub, () => (function () { Object.freeze(arguments); arguments[0] = 9; return arguments[0]; })(1), () => (function (p) { Object.freeze(arguments); p = 9; return arguments[0]; })(1), () => Object.freeze(new Uint8Array(2)), () => Object.freeze(new Uint8Array(0)).length, () => Object.isFrozen(Object.freeze('ab')));
"""}

# ---- arrays made by a length of unknown type
cases["arrays-made-by-a-length-of-unknown-type"] = {"main.cjs": H + """function byNew(n) { return new Array(n); }
function byCall(n) { return Array(n); }
function two(n, m) { return new Array(n, m); }
function filled(n) { return new Array(n).fill(0); }
function spreadIn(args) { return new Array(...args); }
for (let i = 0; i < 300; i++) { byNew(i % 4); byCall(i % 3); filled(2); }
const values = [0, 1, 3, -0, -1, 1.5, NaN, Infinity, -Infinity, 4294967295, 4294967296, 2147483648, 1e3, '3', '', 'x', null, undefined, true, false, [], [3], {}, { valueOf() { return 2; } }, 2n, Symbol.iterator, () => 1, new Number(3), new String('3')];
const show = v => say(() => { const a = v(); return '[' + Array.from({ length: Math.min(a.length, 3) }, (x, i) => i in a ? typeof a[i] : '-').join() + ']#' + a.length; });
for (const f of [byNew, byCall]) console.log(f.name, values.map(v => show(() => f(v))).join(' | '));
console.log('filled', values.filter(v => !(typeof v === 'number' && v > 1e4)).map(v => show(() => filled(v))).join(' | '));
console.log('two', values.slice(0, 8).map(v => show(() => two(v, 1))).join(' | '));
console.log('spread', [[], [3], ['3'], [1, 2], [-1], [undefined]].map(v => show(() => spreadIn(v))).join(' | '));
line('what it is', () => { const a = byNew(3); return [0 in a, a[0], a.length, Object.keys(a).length, a.indexOf(undefined), a.includes(undefined), JSON.stringify(a), a.join('-')].join(' '); }, () => { const a = byNew(2); a[0] = 1.5; a[1] = 'x'; a.push({}); return a.length + typeof a[2]; }, () => byNew(3).map(() => 1), () => Array.from(byNew(2), () => 1), () => [...byNew(2)].length, () => { const a = byNew(0); a.push(1); return a; }, () => { const a = byNew(100000); a[99999] = 1; return a.length + ':' + (50 in a); }, () => Object.getPrototypeOf(byNew(1)) === Array.prototype, () => byNew(1).constructor === Array);
class Sub extends Array {} function bySub(n) { return new Sub(n); } line('a subclass', () => bySub(3).length, () => bySub('3').length, () => bySub(-1), () => bySub(2) instanceof Sub, () => Reflect.construct(Array, [2], Sub) instanceof Sub, () => Reflect.construct(Array, [2], Object).length);
line('order', () => { const log = []; try { byNew({ valueOf() { log.push('valueOf'); return 1; } }); } catch (e) { log.push(e.name); } return log.join() || 'nothing asked'; });
"""}

# ---- xgo1
cases["reads-past-the-end"] = {"main.cjs": H + """function at(o, i) { return o[i]; }
for (let i = 0; i < 400; i++) { at('abc', i % 6); at(new Uint8Array(3), i % 6); at('\\u0416\\u0416', i % 4); at(new Float64Array(2), i % 4); }
const keys = [0, 1, 2, 3, 10, -1, -0, 1.5, NaN, Infinity, 4294967295, 4294967296, 2147483647, 2147483648, '0', '3', '10', '-1', '-0', '1.5', '01', '1e1', 'NaN', 'Infinity', 'length', 'x', '', null, undefined, true, Symbol.iterator];
const boxed = Object.assign(new String('ab'), { 5: 'own five', x: 'own x' });
class T extends Uint8Array { get 10() { return 'class ten'; } get x() { return 'class x'; } }
const protoTen = Object.setPrototypeOf(new Uint8Array(2), Object.create(Uint8Array.prototype, { 10: { value: 'proto ten' }, '-1': { value: 'proto minus one' }, '1.5': { value: 'proto fraction' }, y: { value: 'proto y' } }));
const strProto = Object.setPrototypeOf(new String('ab'), Object.create(String.prototype, { 10: { value: 'proto ten' }, '-1': { value: 'proto minus one' } }));
const grown = (() => { const b = new ArrayBuffer(2, { maxByteLength: 8 }); return [b, new Uint8Array(b)]; })();
const gone = new Uint8Array(4); structuredClone(gone.buffer, { transfer: [gone.buffer] });
const things = { latin: 'abc', wide: '\\u0416\\u0416\\u0416', empty: '', rope: 'ab'.repeat(3) + String(1), sliced: 'xxabcxx'.slice(2, 5), boxed, strProto, u8: new Uint8Array([1, 2, 3]), i32: new Int32Array([1, 2, 3]), f64: new Float64Array([1.5, 2.5, 3.5]), big: new BigInt64Array([1n, 2n, 3n]), clamped: new Uint8ClampedArray(3), none: new Uint8Array(0), sub: new T(3), protoTen, offset: new Uint8Array(new ArrayBuffer(8), 4, 2), tracking: grown[1], gone, buffer: Buffer.from('abc'), view: new DataView(new ArrayBuffer(2)), array: [1, 2, 3], args: (function () { return arguments; })(1, 2, 3) };
for (const [name, o] of Object.entries(things)) console.log(name, keys.map(k => say(() => at(o, k))).join(' | '));
line('a buffer that grows and shrinks', () => { const r = [at(grown[1], 1), at(grown[1], 2)]; grown[0].resize(4); r.push(at(grown[1], 2), at(grown[1], 4)); grown[0].resize(1); r.push(at(grown[1], 0), at(grown[1], 1)); return r.join(); });
line('primitives and nil', () => at(5, 0), () => at(true, 0), () => at(null, 0), () => at(undefined, 10), () => at(1n, 0), () => at(Symbol.iterator, 0));
"""}

# ---- xne1
NS_LIB = "export let count = 1; export const fixed = 'f'; export function bump() { count++; return count; } export default 'the default'; export class K { static s = 1 } export { count as 'a name with spaces', fixed as then_ }; export let late; export function setLate(v) { late = v; }\n"
cases["exports-read-off-a-namespace"] = {"main.mjs": H + """import * as ns from './lib.mjs'; import * as cyc from './cycle-a.mjs'; import * as star from './star.mjs'; import * as cjs from './c.cjs';
function read(o, k) { return o[k]; }
function dotted(o) { return o.count; }
for (let i = 0; i < 400; i++) { read(ns, i % 2 ? 'count' : 'fixed'); dotted(ns); }
const keys = ['count', 'fixed', 'bump', 'default', 'K', 'a name with spaces', 'then_', 'late', 'missing', 'then', 'toString', 'constructor', '__proto__', 'hasOwnProperty', '', '0', 0, Symbol.toStringTag, Symbol.iterator, null, undefined];
console.log('ns', keys.map(k => say(() => { const v = read(ns, k); return typeof v === 'function' ? 'function ' + v.name : v; })).join(' | '));
line('live', () => { const before = read(ns, 'count'); ns.bump(); return before + ',' + read(ns, 'count') + ',' + dotted(ns) + ',' + read(ns, 'a name with spaces'); }, () => { const before = read(ns, 'late'); ns.setLate(5); return before + ',' + read(ns, 'late'); });
line('stores', () => { ns.count = 9; }, () => { ns.missing = 1; }, () => Reflect.set(ns, 'count', 9), () => delete ns.count, () => delete ns.missing, () => Reflect.defineProperty(ns, 'count', { value: 1 }), () => Object.isFrozen(ns), () => Object.isSealed(ns), () => Object.isExtensible(ns), () => JSON.stringify(Object.getOwnPropertyDescriptor(ns, 'count')), () => Object.getPrototypeOf(ns), () => Object.keys(ns).join(), () => Reflect.ownKeys(ns).length, () => 'count' in ns, () => 'missing' in ns, () => Object.prototype.hasOwnProperty.call(ns, 'late'), () => String(ns[Symbol.toStringTag]));
line('a cycle', () => cyc.seen, () => cyc.a, () => read(cyc, 'b'));
line('star and ambiguity', () => Object.keys(star).join(), () => read(star, 'shared'), () => read(star, 'justOne'), () => read(star, 'default'), () => read(star, 'own'));
line('a CommonJS module', () => Object.keys(cjs).sort().join(), () => read(cjs, 'a'), () => read(cjs, 'default').a, () => { cjs.default.a = 5; return read(cjs, 'a') + ',' + cjs.default.a; }, () => read(cjs, 'added'), () => { cjs.default.added = 1; return read(cjs, 'added'); }, () => read(cjs, '__esModule'));
line('other receivers at the same site', () => read({ count: 'plain' }, 'count'), () => read(Object.create(ns), 'count'), () => read(new Proxy(ns, {}), 'count'), () => read([1], 'count'), () => read('s', 'count'), () => dotted({ count: 2 }), () => dotted(Object.create(ns)), () => dotted(null));
const dyn = await import('./lib.mjs'); line('import()', () => dyn === ns, () => read(dyn, 'count'), () => typeof dyn.then);
""", "lib.mjs": NS_LIB,
    "cycle-a.mjs": "import * as self from './cycle-b.mjs'; export const a = 'a made'; export { b } from './cycle-b.mjs'; export const seen = self.early;\n",
    "cycle-b.mjs": "import * as a from './cycle-a.mjs'; export const b = 'b made'; export let early; try { early = String(a.a); } catch (e) { early = e.name; }\n",
    "star.mjs": "export * from './s1.mjs'; export * from './s2.mjs'; export const own = 'own';\n", "s1.mjs": "export const shared = 1, justOne = 'one'; export default 'd1';\n", "s2.mjs": "export const shared = 2;\n",
    "c.cjs": "module.exports = { a: 1, b: 2 };\n"}

# ---- ts6
cases["json-of-optional-members"] = {"main.ts": """declare const console: { log(...v: unknown[]): void };
interface Opt { id: number; name?: string; flag?: boolean; on: boolean; n?: number; o?: { x?: number; y?: boolean }; list?: boolean[]; u?: undefined; nil?: null; either?: boolean | string; big?: bigint }
const say = (f: () => unknown): string => { try { return String(f()); } catch (e) { return "THROWS " + (e as Error).name; } };
function write(o: Opt): string { return JSON.stringify(o); }
function pretty(o: Opt): string { return JSON.stringify(o, null, 1); }
const made: Opt[] = [{ id: 1, on: true }, { id: 2, on: false, flag: true }, { id: 3, on: true, flag: false }, { id: 4, on: true, flag: undefined }, { id: 5, on: true, name: "n" }, { id: 6, on: true, name: undefined, n: undefined }, { id: 7, on: false, n: 0 }, { id: 8, on: false, n: -0 }, { id: 9, on: false, n: NaN }, { id: 10, on: true, o: {} }, { id: 11, on: true, o: { y: false } }, { id: 12, on: true, o: { x: 1, y: true } }, { id: 13, on: true, list: [] }, { id: 14, on: true, list: [true, false] }, { id: 15, on: true, u: undefined, nil: null }, { id: 16, on: true, either: false }, { id: 17, on: true, either: "s" }, { id: 18, on: true, either: undefined }];
for (let r = 0; r < 200; r++) for (const o of made) write(o);
for (const o of made) console.log(write(o), pretty(o).length);
const late: Opt = { id: 20, on: true }; console.log(write(late)); late.flag = true; console.log(write(late)); late.name = "later"; console.log(write(late)); late.flag = false; console.log(write(late)); delete late.flag; console.log(write(late)); late.flag = undefined; console.log(write(late)); late.o = { y: true }; console.log(write(late)); delete late.o.y; console.log(write(late)); delete late.name; late.name = "again"; console.log(write(late), Object.keys(late).join());
console.log(say(() => write({ id: 21, on: true, big: 1n })), say(() => write(Object.assign({ id: 22, on: true } as Opt, { extra: 1 }))), say(() => write(Object.assign({ id: 23, on: true } as Opt, { toJSON() { return "mine"; } }))), say(() => write(Object.freeze({ id: 24, on: false, flag: true } as Opt))), say(() => write(Object.create({ id: 25, on: true }) as Opt)), say(() => write(JSON.parse('{"id":26,"on":true,"flag":false,"zz":1}') as Opt)), say(() => write(JSON.parse('{"flag":true,"on":false,"id":27}') as Opt)));
const any = (v: unknown): any => v; console.log(say(() => { const o: Opt = { id: 30, on: true }; any(o).flag = "not a boolean"; return write(o); }), say(() => { const o: Opt = { id: 31, on: true }; any(o).on = 1; return write(o); }), say(() => { const o: Opt = { id: 32, on: true, flag: true }; Object.defineProperty(o, "flag", { get() { return false; }, enumerable: true }); return write(o); }), say(() => { const o: Opt = { id: 33, on: true, flag: true }; Object.defineProperty(o, "flag", { enumerable: false }); return write(o); }));
console.log(say(() => JSON.stringify(made)), say(() => JSON.stringify({ rows: made.slice(0, 3), ok: true })).length, say(() => JSON.stringify(made, ["id", "flag"])), say(() => JSON.stringify(made.slice(0, 4), (k, v) => typeof v === "boolean" ? +v : v)));
"""}

# ---- gs1
cases["reads-by-name-at-a-guessed-place"] = {"main.cjs": H + """function name(o) { return o.name; }
function deep(o) { return o.a.b.c; }
function both(o) { return o.x + ':' + o.y; }
const shapes = [() => ({ name: 'first' }), () => ({ a: 1, name: 'second' }), () => ({ a: 1, b: 2, name: 'third' }), () => ({ name: 'again', z: 1 }), () => { const o = {}; for (let i = 0; i < 40; i++) o['k' + i] = i; o.name = 'many'; return o; }, () => { const o = { name: 'deleted' }; delete o.name; return o; }, () => { const o = { x: 1, name: 'moved' }; delete o.x; return o; }, () => Object.create({ name: 'inherited' }), () => Object.create(Object.create({ name: 'twice' })), () => ({ get name() { return 'got'; } }), () => Object.defineProperty({}, 'name', { value: 'hidden' }), () => function named() {}, () => class Klass {}, () => new (class { name = 'field'; })(), () => new (class { get name() { return 'class getter'; } })(), () => new Error('e'), () => Symbol('s').constructor, () => [1], () => 'str', () => 5, () => new Proxy({}, { get: (t, k) => 'trap ' + String(k) }), () => Object.freeze({ name: 'frozen' }), () => JSON.parse('{"name":"parsed"}'), () => JSON.parse('{"q":1,"name":"parsed later"}'), () => Object.assign(Object.create(null), { name: 'bare' }), () => new Map([['name', 1]]), () => ({ __proto__: null, name: 'literal null proto' }), () => ({ name: undefined }), () => ({ name: null }), () => ({ Name: 'case' })];
for (let r = 0; r < 60; r++) for (const make of shapes) name(make());
console.log(shapes.map(make => say(() => name(make()))).join(' | '));
line('nil', () => name(null), () => name(undefined), () => deep({ a: { b: { c: 1 } } }), () => deep({ a: { b: null } }), () => deep({ a: {} }), () => deep({}));
line('a shape that changes between two reads', () => { const o = { x: 1, get y() { delete o.x; o.pad = 1; o.x = 'moved'; return 2; } }; return both(o) + ' ' + both(o); }, () => { const o = { get x() { Object.defineProperty(o, 'y', { value: 'redefined', configurable: true }); return 1; }, y: 'old' }; return both(o); }, () => { const p = { y: 'proto' }; const o = Object.create(p, { x: { get() { p.y = 'changed'; return 1; } } }); return both(o); }, () => { const p = { y: 'proto' }; const o = Object.create(p); o.x = 1; const first = both(o); o.y = 'own'; const second = both(o); delete o.y; return [first, second, both(o)].join(' '); }, () => { const p = { y: 'first proto' }; const o = Object.create(p); o.x = 1; const first = both(o); Object.setPrototypeOf(o, { y: 'second proto' }); return first + ' ' + both(o); });
line('same shape, other place', () => { const r = []; for (let i = 0; i < 50; i++) { const o = i % 2 ? { p: 0, name: 'odd' + i } : { name: 'even' + i, p: 0 }; r.push(name(o)); } return r.slice(-4).join(); }, () => { const big = {}; for (let i = 0; i < 2000; i++) big['p' + i] = i; big.name = 'dictionary'; const a = name(big); delete big.p5; big.name2 = 1; return a + name(big); });
"""}

# ---- us13
cases["a-key-that-is-the-same-symbol-on-every-way"] = {"main.cjs": H + """const kA = Symbol('a'), kB = Symbol('b'); let kLet = Symbol('let');
function pick(flag) { let k; if (flag) k = kA; else k = kA; return { [k]: 1 }[kA]; }
function differs(flag) { let k; if (flag) k = kA; else k = kB; const o = { [kA]: 'a', [kB]: 'b' }; return o[k]; }
function loop(n) { let k = kA; const o = { [kA]: 'a', [kB]: 'b' }; let s = ''; for (let i = 0; i < n; i++) { s += o[k]; if (i === 1) k = kB; } return s; }
function viaTry(t) { let k = kA; try { if (t) throw 1; k = kA; } catch (e) { k = kB; } return { [kA]: 'a', [kB]: 'b' }[k]; }
function viaSwitch(v) { let k; switch (v) { case 1: k = kA; break; case 2: k = kA; break; default: k = kA; } return { [kA]: v }[k]; }
function fallsThrough(v) { let k = kB; switch (v) { case 1: k = kA; case 2: break; default: k = kA; } return { [kA]: 'a', [kB]: 'b' }[k]; }
function unset(flag) { let k; if (flag) k = kA; return { [kA]: 'a', undefined: 'u' }[k]; }
function param(k = kA) { return { [kA]: 'a', [kB]: 'b' }[k]; }
function closure() { let k = kA; const set = () => { k = kB; }; const o = { [kA]: 'a', [kB]: 'b' }; const first = o[k]; set(); return first + o[k]; }
function reassignedLet() { const o = { [kLet]: 'old' }; const before = o[kLet]; kLet = Symbol('let'); return before + ':' + o[kLet]; }
function* gen() { let k = kA; const o = { [kA]: 'a', [kB]: 'b' }; const got = yield o[k]; if (got) k = kB; yield o[k]; }
function cond(f) { const k = f ? kA : kA; const j = f ? kA : kB; const o = { [kA]: 'a', [kB]: 'b' }; return o[k] + o[j]; }
function logical(x) { const k = x || kA; const j = x ?? kA; const o = { [kA]: 'a', [kB]: 'b', 0: 'zero' }; return String(o[k]) + String(o[j]); }
for (let i = 0; i < 300; i++) { pick(i & 1); differs(i & 1); loop(3); viaTry(i & 1); viaSwitch(i % 3); cond(i & 1); }
line('ways', () => pick(true) + pick(false), () => differs(true) + differs(false), () => loop(4), () => viaTry(false) + viaTry(true), () => [1, 2, 3].map(viaSwitch).join(), () => [1, 2, 3].map(fallsThrough).join(), () => unset(true) + unset(false), () => param() + param(kB) + param(undefined), () => closure(), () => reassignedLet(), () => { const g = gen(); return g.next().value + g.next(true).value; }, () => { const g = gen(); return g.next().value + g.next(false).value; }, () => cond(true) + cond(false), () => logical(kB) + logical(0) + logical(null));
"""}

for name, files in cases.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for f, text in files.items():
        with open(os.path.join(out, name, f), "w") as h:
            h.write(text)
print(len(cases), "cases")

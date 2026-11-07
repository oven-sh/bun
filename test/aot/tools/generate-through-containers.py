# generate-through-containers.py <folder>: all 168; ../parallel/through-containers/ holds 8 of them: one shape a program; each prints what plain Bun prints.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

head = '''class A { constructor() { this.x = "a"; this.y = 1; } get k() { return "A"; } }
class B { constructor() { this.x = "b"; this.y = 2; } get k() { return "B"; } }
class C { constructor() { this.x = "c"; this.y = 3; } get k() { return "C"; } }
class D { constructor() { this.x = "d"; this.y = 4; } get k() { return "D"; } }
class E { constructor() { this.x = "e"; this.y = 5; } get k() { return "E"; } }
class F { constructor() { this.x = "f"; this.y = 6; } get k() { return "F"; } }
function showA(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showB(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showC(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showD(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showE(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function showF(o) { return typeof o.x + " " + o.x + " " + (o.y + 1) + " " + Object.keys(o).join("|") + " " + o.k + " " + Object.isFrozen(o); }
function changeA(o) { o.x = 7; }
function changeB(o) { o.z = true; }
function changeC(o) { delete o.y; }
function changeD(o) { Object.defineProperty(o, "x", { get() { return 42; }, configurable: true, enumerable: true }); }
function changeE(o) { Object.setPrototypeOf(o, { get k() { return "other"; } }); }
function changeF(o) { Object.freeze(o); try { o.x = 9; } catch {} }
'''
sync_tail = '''const a = new A(), b = new B(), c = new C(), d = new D(), e = new E(), f = new F();
console.log(showA(a), showB(b), showC(c), showD(d), showE(e), showF(f));
changeA(throughA(a)); changeB(throughB(b)); changeC(throughC(c)); changeD(throughD(d)); changeE(throughE(e)); changeF(throughF(f));
console.log(showA(a));
console.log(showB(b));
console.log(showC(c));
console.log(showD(d));
console.log(showE(e));
console.log(showF(f));
'''
async_tail = '''const a = new A(), b = new B(), c = new C(), d = new D(), e = new E(), f = new F();
console.log(showA(a), showB(b), showC(c), showD(d), showE(e), showF(f));
async function main() {
  changeA(await throughA(a)); changeB(await throughB(b)); changeC(await throughC(c)); changeD(await throughD(d)); changeE(await throughE(e)); changeF(await throughF(f));
  console.log(showA(a));
  console.log(showB(b));
  console.log(showC(c));
  console.log(showD(d));
  console.log(showE(e));
  console.log(showF(f));
}
main();
'''
# name: (is async, helpers with @ for the letter, body of through@(o))
cases = {
 'for-of': (0, '', 'const list = [o]; let t; for (const v of list) t = v; return t;'),
 'for-of-in-another-function': (0, 'function last@(list) { let t; for (const v of list) t = v; return t; }', 'return last@([o]);'),
 'spread-into-a-list': (0, 'function copy@(list) { return [...list]; }', 'return copy@([o])[0];'),
 'spread-into-a-call': (0, 'function first@(v) { return v; }\nfunction pass@(list) { return first@(...list); }', 'return pass@([o]);'),
 'destructuring-of-a-list': (0, 'function head@(list) { const [v] = list; return v; }', 'return head@([o]);'),
 'destructuring-with-rest': (0, 'function tail@(list) { const [, ...rest] = list; return rest; }', 'return tail@([0, o])[0];'),
 'array-from': (0, 'function copy@(list) { return Array.from(list); }', 'return copy@([o])[0];'),
 'array-from-with-a-mapper': (0, 'function copy@(list) { return Array.from(list, v => v); }', 'return copy@([o])[0];'),
 'callback-of-map': (0, 'function each@(list) { let t; list.map(v => { t = v; return 0; }); return t; }', 'return each@([o]);'),
 'result-of-map': (0, 'function each@(list) { return list.map(v => v); }', 'return each@([o])[0];'),
 'callback-of-for-each': (0, 'function each@(list) { let t; list.forEach(v => { t = v; }); return t; }', 'return each@([o]);'),
 'callback-of-reduce': (0, 'function each@(list) { return list.reduce((t, v) => v, null); }', 'return each@([o]);'),
 'find-and-filter': (0, 'function find@(list) { return list.filter(v => true).find(v => true); }', 'return find@([o]);'),
 'iterator-held-in-a-variable': (0, 'function open@(list) { return list[Symbol.iterator](); }\nfunction step@(it) { return it.next(); }', 'const it = open@([o]); const r = step@(it); return r.value;'),
 'values-keys-entries': (0, 'function pair@(list) { for (const p of list.entries()) return p; }', 'const list = [o]; const p = pair@(list); let t; for (const v of list.values()) t = v; return p[0] === 0 && t === p[1] ? p[1] : null;'),
 'push-and-pop': (0, 'function put@(list, v) { list.push(v); }\nfunction take@(list) { return list.pop(); }', 'const list = []; put@(list, o); return take@(list);'),
 'unshift-and-shift': (0, 'function put@(list, v) { list.unshift(v); }\nfunction take@(list) { return list.shift(); }', 'const list = []; put@(list, o); return take@(list);'),
 'slice-concat-at': (0, 'function move@(list) { return list.slice().concat([]).at(0); }', 'return move@([o]);'),
 'splice-reverse-sort': (0, 'function move@(list) { return list.reverse().sort().splice(0, 1); }', 'return move@([o])[0];'),
 'flat-of-nested-lists': (0, 'function move@(list) { return list.flat(); }', 'return move@([[o]])[0];'),
 'nested-for-of': (0, 'function move@(lists) { let t; for (const list of lists) for (const v of list) t = v; return t; }', 'return move@([[o]]);'),
 'index-store-and-read': (0, 'function put@(list, i, v) { list[i] = v; }\nfunction take@(list, i) { return list[i]; }', 'const list = []; put@(list, 0, o); return take@(list, 0);'),
 'fill-and-index': (0, 'function put@(list, v) { list.fill(v); }', 'const list = [0]; put@(list, o); return list[0];'),
 'map-set-and-get': (0, 'function put@(m, v) { m.set("k", v); }\nfunction take@(m) { return m.get("k"); }', 'const m = new Map(); put@(m, o); return take@(m);'),
 'for-of-over-a-map': (0, 'function take@(m) { let t; for (const [k, v] of m) t = v; return t; }', 'return take@(new Map([["k", o]]));'),
 'keys-of-a-map': (0, 'function take@(m) { let t; for (const k of m.keys()) t = k; return t; }', 'const m = new Map(); m.set(o, 1); return take@(m);'),
 'for-each-of-a-map': (0, 'function take@(m) { let t; m.forEach((v, k) => { t = v; }); return t; }', 'const m = new Map(); m.set("k", o); return take@(m);'),
 'for-of-over-a-set': (0, 'function take@(s) { let t; for (const v of s) t = v; return t; }', 'const s = new Set(); s.add(o); return take@(s);'),
 'set-from-a-list-and-spread': (0, 'function take@(list) { return [...new Set(list)]; }', 'return take@([o])[0];'),
 'weak-map': (0, 'function take@(m, k) { return m.get(k); }', 'const k = {}; const m = new WeakMap(); m.set(k, o); return take@(m, k);'),
 'rest-parameter': (0, 'function take@(...all) { return all; }', 'return take@(0, o)[1];'),
 'arguments-object': (0, 'function take@() { return arguments[1]; }', 'return take@(0, o);'),
 'arguments-handed-on': (0, 'function inner@(list) { return list[0]; }\nfunction take@() { return inner@(arguments); }', 'return take@(o);'),
 'apply-with-a-list': (0, 'function first@(v) { return v; }', 'return first@.apply(null, [o]);'),
 'generator': (0, 'function* gen@(v) { yield v; }', 'let t; for (const v of gen@(o)) t = v; return t;'),
 'generator-stepped-by-hand': (0, 'function* gen@(v) { yield 0; return v; }', 'const g = gen@(o); g.next(); return g.next().value;'),
 'value-sent-into-a-generator': (0, 'function* gen@(box) { box.v = yield 0; }', 'const box = { v: null }; const g = gen@(box); g.next(); g.next(o); return box.v;'),
 'object-values-and-entries': (0, 'function take@(r) { return Object.entries(r)[0][1] === Object.values(r)[0] ? Object.values(r)[0] : null; }', 'return take@({ k: o });'),
 'object-from-entries': (0, 'function take@(list) { return Object.fromEntries(list); }', 'return take@([["k", o]]).k;'),
 'await-of-an-async-function': (1, 'async function make@(v) { return v; }', 'return await make@(o);'),
 'await-of-what-is-no-promise': (1, 'function make@(v) { return v; }', 'return await make@(o);'),
 'await-of-a-thenable': (1, 'function make@(v) { return { then(resolve) { resolve(v); } }; }', 'return await make@(o);'),
 'async-function-returns-a-promise': (1, 'async function inner@(v) { return v; }\nasync function make@(v) { return inner@(v); }', 'return await make@(o);'),
 'promise-all': (1, 'async function make@(v) { return v; }', 'return (await Promise.all([make@(o), 1]))[0];'),
 'promise-all-settled-race-any': (1, 'async function make@(v) { return v; }', 'const s = await Promise.allSettled([make@(o)]); const r = await Promise.race([make@(o)]); const n = await Promise.any([make@(o)]); return s[0].value === r && r === n ? n : null;'),
 'promise-then': (1, 'async function make@(v) { return v; }', 'let t; await make@(o).then(v => { t = v; }); return t;'),
 'promise-then-chained': (1, 'async function make@(v) { return v; }', 'return await make@(o).then(v => v).finally(() => 0).catch(() => 0);'),
 'promise-resolve': (1, '', 'return await Promise.resolve(o);'),
 'new-promise': (1, 'function make@(v) { return new Promise(resolve => { resolve(v); }); }', 'return await make@(o);'),
 'promise-with-resolvers': (1, '', 'const r = Promise.withResolvers(); r.resolve(o); return await r.promise;'),
 'rejection-caught-by-await': (1, 'async function fail@(v) { throw v; }', 'try { await fail@(o); } catch (v) { return v; }'),
 'rejection-caught-by-catch': (1, 'async function fail@(v) { throw v; }', 'let t; await fail@(o).catch(v => { t = v; }); return t;'),
 'async-generator': (1, 'async function* gen@(v) { yield v; }', 'let t; for await (const v of gen@(o)) t = v; return t;'),
 'for-await-over-a-list-of-promises': (1, 'async function make@(v) { return v; }', 'let t; for await (const v of [make@(o)]) t = v; return t;'),
 'promise-held-in-a-list': (1, 'async function make@(v) { return v; }\nfunction keep@(list, p) { list.push(p); }', 'const list = []; keep@(list, make@(o)); let t; for (const p of list) t = await p; return t;'),
 'two-lists-that-meet': (0, 'function pick@(l, m, w) { return w ? l : m; }', 'const l = [o], m = [1]; return pick@(l, m, true)[0];'),
 'list-and-map-that-meet': (0, 'function pick@(l, m, w) { return w ? l : m; }\nfunction take@(h) { let t; for (const v of h) t = v; return t; }', 'const l = [o], m = new Map(); return take@(pick@(l, m, true));'),
 'list-with-a-name-laid-on-it': (0, 'function take@(list) { return list.map(v => v); }', 'const list = [o]; list.map = function () { return [this[0]]; }; return take@(list)[0];'),
 'list-with-a-getter-at-an-index': (0, 'function take@(list) { let t; for (const v of list) t = v; return t; }', 'const list = [0]; Object.defineProperty(list, 0, { get() { return o; } }); return take@(list);'),
 'list-with-another-iterator': (0, 'function take@(list) { let t; for (const v of list) t = v; return t; }', 'const list = [0]; list[Symbol.iterator] = function* () { yield o; }; return take@(list);'),
 'class-that-extends-array': (0, 'class L@ extends Array {}\nfunction take@(list) { let t; for (const v of list) t = v; return t; }', 'const list = new L@(); list.push(o); return take@(list);'),
 'class-that-extends-map': (0, 'class M@ extends Map {}\nfunction take@(m) { return m.get("k"); }', 'const m = new M@(); m.set("k", o); return take@(m);'),
 'class-that-extends-promise': (1, 'class P@ extends Promise {}', 'return await P@.resolve(o);'),
 'iterator-helpers': (0, 'function take@(list) { return list.values().map(v => v).toArray(); }', 'return take@([o])[0];'),
 'tagged-template': (0, 'function tag@(strings, ...values) { return values; }', 'return tag@`a${o}b`[0];'),
 'list-in-a-field': (0, 'class H@ { constructor() { this.items = []; } add(v) { this.items.push(v); } first() { return this.items[0]; } }', 'const h = new H@(); h.add(o); return h.first();'),
 'list-in-a-closure': (0, 'function make@() { const items = []; return { add(v) { items.push(v); }, all() { return items; } }; }', 'const h = make@(); h.add(o); let t; for (const v of h.all()) t = v; return t;'),
 'promise-with-a-then-of-its-own': (1, 'async function make@(v) { return 0; }', 'const p = make@(o); p.constructor = null; p.then = function (resolve) { resolve(o); }; return await p;'),
 'instanceof-with-a-static-has-instance': (0, 'let keep@;\nclass T@ { static [Symbol.hasInstance](v) { keep@ = v; return true; } }', 'if (o instanceof T@) return keep@;'),
 'instanceof-of-a-bound-function': (0, 'let keep@;\nclass T@ { static [Symbol.hasInstance](v) { keep@ = v; return true; } }\nconst bound@ = T@.bind(null);', 'if (o instanceof bound@) return keep@;'),
 'instanceof-with-has-instance-defined-later': (0, 'let keep@;\nfunction T@() {}\nObject.defineProperty(T@, Symbol.hasInstance, { value(v) { keep@ = v; return true; } });', 'if (o instanceof T@) return keep@;'),
 'to-string-laid-on-a-function': (0, 'let keep@;\nfunction f@() {}', 'f@.held = o; f@.toString = function () { keep@ = this.held; return ""; }; String(f@); return keep@;'),
 'list-converted-to-a-text': (0, 'let keep@;\nclass W@ { constructor(v) { this.v = v; } toString() { keep@ = this.v; return ""; } }', 'String([new W@(o)]); return keep@;'),
 'list-of-lists-joined': (0, 'let keep@;\nclass W@ { constructor(v) { this.v = v; } toString() { keep@ = this.v; return ""; } }', '[[[new W@(o)]]].join(); return keep@;'),
 'array-from-a-list-with-another-iterator': (0, 'function copy@(list) { return Array.from(list); }', 'const list = [0]; list[Symbol.iterator] = function* () { yield o; }; return copy@(list)[0];'),
 'array-from-with-a-mapper-over-a-getter': (0, 'function copy@(list) { return Array.from(list, v => v); }', 'const list = [0]; Object.defineProperty(list, 0, { get() { return o; } }); return copy@(list)[0];'),
 'array-from-an-array-like': (0, 'function copy@(like) { return Array.from(like); }', 'return copy@({ length: 1, 0: o })[0];'),
 'array-from-called-on-another-constructor': (0, 'let keep@;\nfunction Other@() { keep@ = this; }', 'Array.from.call(Other@, [o]); return keep@[0];'),
 'object-converted-by-a-built-in': (0, 'let keep@;\nclass W@ { constructor(v) { this.v = v; } toString() { keep@ = this.v; return "1"; } }', 'String(new W@(o)); return keep@;'),
 'object-converted-to-a-number-by-a-built-in': (0, 'let keep@;\nclass W@ { constructor(v) { this.v = v; } valueOf() { keep@ = this.v; return 1; } }', 'Math.abs(new W@(o)); return keep@;'),
 'object-converted-to-a-key-by-a-built-in': (0, 'let keep@;\nclass W@ { constructor(v) { this.v = v; } toString() { keep@ = this.v; return "k"; } }', 'Object.hasOwn({}, new W@(o)); return keep@;'),
 'json-stringify-with-to-json': (0, 'let keep@;\nclass W@ { constructor(v) { this.v = v; } toJSON() { keep@ = this.v; return 0; } }', 'JSON.stringify([{ inner: new W@(o) }]); return keep@;'),
 'json-stringify-with-a-getter': (0, 'let keep@;', 'JSON.stringify([{ get g() { keep@ = this.v; return 0; }, v: o }]); return keep@;'),
 'json-stringify-with-a-replacer': (0, 'let keep@;', 'JSON.stringify([{ v: o }], (k, v) => { if (k === "v") keep@ = v; return v; }); return keep@;'),
 'json-stringify-with-to-json-laid-on-later': (0, 'let keep@;\nfunction text@(v) { return JSON.stringify(v); }', 'const h = { v: o }; text@([h]); h.toJSON = function () { keep@ = this.v; return 0; }; text@([h]); return keep@;'),
 'structured-clone-with-a-getter': (0, 'let keep@;', 'structuredClone([{ get g() { keep@ = this.v; return 0; }, v: o }]); return keep@;'),
 'console-log-with-a-custom-inspect': (0, 'let keep@;', 'console.log([{ [Symbol.for("nodejs.util.inspect.custom")]() { keep@ = this.v; return ""; }, v: o }]); return keep@;'),
 'object-values-of-a-record': (0, 'function all@(r) { return Object.values(r); }', 'return all@({ a: 1, b: o })[1];'),
 'object-values-of-a-record-with-a-getter': (0, 'let keep@;\nfunction all@(r) { return Object.values(r); }', 'all@({ get g() { keep@ = this.v; return 0; }, v: o }); return keep@;'),
 'object-values-of-a-record-that-gained-a-property': (0, 'function all@(r) { return Object.values(r); }', 'const r = { a: 1 }; r.late = o; return all@(r)[1];'),
 'object-values-of-an-instance': (0, 'class H@ { constructor(v) { this.v = v; } }\nfunction all@(r) { return Object.values(r); }', 'return all@(new H@(o))[0];'),
 'object-values-under-a-computed-key': (0, 'function all@(r) { return Object.values(r); }\nfunction put@(r, k, v) { r[k] = v; }', 'const r = { a: 1 }; put@(r, "k" + 1, o); return all@(r)[1];'),
 'object-spread': (0, '', 'const c = { ...{ v: o } }; return c.v;'),
 'object-spread-in-another-function': (0, 'function copy@(r) { return { ...r }; }', 'return copy@({ v: o }).v;'),
 'object-spread-beside-other-fields': (0, 'function copy@(r) { return { a: 1, ...r, b: 2 }; }', 'return copy@({ v: o }).v;'),
 'object-rest': (0, 'function rest@(r) { const { a, ...others } = r; return others; }', 'return rest@({ a: 1, v: o }).v;'),
 'object-assign-into-a-literal': (0, 'function copy@(r) { return Object.assign({}, r); }', 'return copy@({ v: o }).v;'),
 'object-assign-onto-a-record': (0, 'function fill@(t, r) { Object.assign(t, r); }', 'const t = { v: null }; fill@(t, { v: o }); return t.v;'),
 'object-spread-of-a-record-that-gained-a-property': (0, 'function copy@(r) { return { ...r }; }', 'const r = { a: 1 }; r.late = o; return copy@(r).late;'),
 'object-spread-with-a-getter': (0, 'let keep@;\nfunction copy@(r) { return { ...r }; }', 'copy@({ get g() { keep@ = this.v; return 0; }, v: o }); return keep@;'),
 'object-spread-of-an-instance': (0, 'class H@ { constructor(v) { this.v = v; } }\nfunction copy@(r) { return { ...r }; }', 'return copy@(new H@(o)).v;'),
 'object-assign-with-a-setter-on-the-target': (0, 'let keep@;\nfunction fill@(t, r) { Object.assign(t, r); }', 'fill@({ set v(x) { keep@ = x; } }, { v: o }); return keep@;'),
 'object-assign-onto-an-instance': (0, 'class H@ { constructor() { this.v = null; } }\nfunction fill@(t, r) { Object.assign(t, r); }', 'const h = new H@(); fill@(h, { v: o }); return h.v;'),
 'object-spread-of-a-list': (0, 'function copy@(r) { return { ...r }; }', 'return copy@([o])[0];'),
 'object-assign-onto-an-unseen-object': (0, 'function fill@(t, r) { Object.assign(t, r); }', 'const t = JSON.parse("{}"); fill@(t, { v: o }); return t.v;'),
 'object-assign-onto-a-function': (0, 'function target@() {}\nfunction fill@(t, r) { Object.assign(t, r); }', 'fill@(target@, { v: o }); return target@.v;'),
 'object-assign-of-a-method-onto-the-global-object': (0, 'function fill@(t, r) { Object.assign(t, r); }', 'fill@(globalThis, { ["take@"]() { return o; } }); return globalThis["take@"]();'),
 'error-cause': (0, 'function wrap@(v) { return new Error("m", { cause: v }); }', 'return wrap@(o).cause;'),
 'error-with-a-property-laid-on': (0, 'function wrap@(v) { const e = new TypeError("m"); e.detail = v; return e; }', 'return wrap@(o).detail;'),
 'aggregate-error': (0, 'function wrap@(v) { return new AggregateError([v], "m"); }', 'return wrap@(o).errors[0];'),
 'suppressed-error': (0, 'function wrap@(v) { return new SuppressedError(v, null, "m"); }', 'return wrap@(o).error;'),
 'thrown-and-caught': (0, 'function raise@(v) { throw v; }', 'try { raise@(o); } catch (e) { return e; }'),
 'thrown-in-an-error-and-caught': (0, 'function raise@(v) { throw new Error("m", { cause: v }); }', 'try { raise@(o); } catch (e) { return e.cause; }'),
 'weak-ref': (0, 'function hold@(v) { return new WeakRef(v); }', 'return hold@(o).deref();'),
 'reflect-get': (0, 'function read@(r) { return Reflect.get(r, "v"); }', 'return read@({ v: o });'),
 'reflect-set-then-read': (0, 'function write@(r, v) { Reflect.set(r, "v", v); }', 'const r = { v: null }; write@(r, o); return r.v;'),
 'reflect-apply': (0, 'function same@(v) { return v; }', 'return Reflect.apply(same@, null, [o]);'),
 'reflect-apply-this': (0, 'function self@() { return this; }', 'return Reflect.apply(self@, o, []);'),
 'reflect-construct': (0, 'class H@ { constructor(v) { this.v = v; } }', 'return Reflect.construct(H@, [o]).v;'),
 'reflect-own-descriptor': (0, 'function describe@(r) { return Reflect.getOwnPropertyDescriptor(r, "v"); }', 'return describe@({ v: o }).value;'),
 'own-descriptor': (0, 'function describe@(r) { return Object.getOwnPropertyDescriptor(r, "v"); }', 'return describe@({ v: o }).value;'),
 'own-descriptors': (0, 'function describe@(r) { return Object.getOwnPropertyDescriptors(r); }', 'return describe@({ v: o }).v.value;'),
 'define-property-then-read': (0, 'function lay@(r, v) { Object.defineProperty(r, "v", { value: v, enumerable: true }); }', 'const r = {}; lay@(r, o); return r.v;'),
 'define-getter-then-read': (0, 'function lay@(r, v) { Object.defineProperty(r, "v", { get() { return v; } }); }', 'const r = {}; lay@(r, o); return r.v;'),
 'create-with-descriptors': (0, 'function make@(v) { return Object.create(null, { v: { value: v } }); }', 'return make@(o).v;'),
 'create-below': (0, 'function make@(v) { return Object.create({ v }); }', 'return make@(o).v;'),
 'create-below-a-setter': (0, 'let kept@;\nfunction make@() { return Object.create({ set v(x) { kept@ = x; } }); }', 'make@().v = o; return kept@;'),
 'object-group-by': (0, 'function group@(l) { return Object.groupBy(l, () => "k"); }', 'return group@([o]).k[0];'),
 'map-group-by': (0, 'function group@(l) { return Map.groupBy(l, () => "k"); }', 'return group@([o]).get("k")[0];'),
 'group-by-callback': (0, 'let kept@;\nfunction group@(l) { return Object.groupBy(l, v => { kept@ = v; return "k"; }); }', 'group@([o]); return kept@;'),
 'with-and-to-spliced': (0, 'function put@(l, v) { return l.with(0, v).toSpliced(1, 0, 5); }', 'return put@([1], o)[0];'),
 'to-reversed-and-to-sorted': (0, 'function turn@(l) { return l.toReversed().toSorted(() => 0); }', 'return turn@([o])[0];'),
 'copy-within': (0, 'function move@(l) { return l.copyWithin(0, 1); }', 'return move@([1, o])[0];'),
 'find-last-and-at': (0, 'function last@(l) { return [l.findLast(() => true)].at(-1); }', 'return last@([o]);'),
 'entries-of-a-list': (0, 'function pairs@(l) { return [...l.entries()]; }', 'return pairs@([o])[0][1];'),
 'entries-of-a-map': (0, 'function pairs@(m) { return [...m.entries()]; }', 'return pairs@(new Map([["k", o]]))[0][1];'),
 'key-of-a-map': (0, 'function keys@(m) { return [...m.keys()]; }', 'return keys@(new Map([[o, 1]]))[0];'),
 'set-union': (0, 'function join@(a, b) { return a.union(b); }', 'return [...join@(new Set(), new Set([o]))][0];'),
 'set-union-with-a-set-like': (0, 'function join@(a, b) { return a.union(b); }', 'return [...join@(new Set(), { size: 1, has() { return true; }, keys() { return [o].values(); } })][0];'),
 'set-intersection': (0, 'function meet@(a, b) { return a.intersection(b); }', 'return [...meet@(new Set([o]), new Set([o]))][0];'),
 'json-parse-reviver-this': (0, 'let kept@;\nfunction revive@(v) { JSON.parse("[1]", function (k, x) { kept@ = v; return x; }); }', 'revive@(o); return kept@;'),
 'replace-with-a-function': (0, 'let kept@;\nfunction swap@(v) { "a".replace("a", () => { kept@ = v; return "b"; }); }', 'swap@(o); return kept@;'),
 'symbol-key': (0, 'const key@ = Symbol("k");\nfunction read@(r) { return r[key@]; }', 'return read@({ [key@]: o });'),
 'proxy-target': (0, 'function wrap@(r) { return new Proxy(r, {}); }', 'return wrap@({ v: o }).v;'),
 'proxy-get-trap': (0, 'function wrap@(v) { return new Proxy({}, { get() { return v; } }); }', 'return wrap@(o).anything;'),
 'proxy-apply-trap': (0, 'function wrap@() { return new Proxy(function () {}, { apply(t, self, list) { return list[0]; } }); }', 'return wrap@()(o);'),
 'bound-this': (0, 'function self@() { return this; }', 'return self@.bind(o)();'),
 'bound-argument': (0, 'function same@(v) { return v; }', 'return same@.bind(null, o)();'),
 'call-and-apply': (0, 'function same@(v) { return v; }', 'return same@.call(null, same@.apply(null, [o]));'),
 'map-for-each-this': (0, 'let kept@;\nfunction walk@(m, t) { m.forEach(function () { kept@ = this; }, t); }', 'walk@(new Map([[1, 1]]), o); return kept@;'),
 'sort-comparator': (0, 'let kept@;\nfunction order@(l) { l.sort((p, q) => { kept@ = p; return 0; }); }', 'order@([o, o]); return kept@;'),
 'array-of': (0, 'function make@(v) { return Array.of(v); }', 'return make@(o)[0];'),
 'new-array-of-values': (0, 'function make@(v) { return new Array(v, v); }', 'return make@(o)[1];'),
 'object-of-an-object': (0, 'function same@(v) { return Object(v); }', 'return same@(o);'),
 'iterator-from': (0, 'function walk@(l) { return Iterator.from(l).toArray(); }', 'return walk@([o])[0];'),
 'iterator-helpers-chain': (0, 'function walk@(l) { return l.values().map(v => v).filter(() => true).take(1).drop(0).toArray(); }', 'return walk@([o])[0];'),
 'iterator-reduce-and-find': (0, 'function walk@(l) { return [l.values().reduce((p, v) => v, null)].values().find(() => true); }', 'return walk@([o]);'),
 'finally-and-then': (1, 'async function make@(v) { return v; }', 'return await make@(o).finally(() => {}).then(v => v);'),
 'queue-microtask': (1, 'let kept@;\nfunction later@(v) { queueMicrotask(() => { kept@ = v; }); }', 'later@(o); await null; return kept@;'),
 'set-timeout-argument': (1, 'function later@(v) { return new Promise(resolve => setTimeout(resolve, 0, v)); }', 'return await later@(o);'),
 'array-from-async': (1, 'async function make@(v) { return Array.fromAsync([Promise.resolve(v)]); }', 'return (await make@(o))[0];'),
 'event-target': (0, 'let kept@;\nfunction send@(v) { const t = new EventTarget(); t.addEventListener("e", e => { kept@ = e.detail; }); t.dispatchEvent(new CustomEvent("e", { detail: v })); }', 'send@(o); return kept@;'),
 'abort-reason': (0, 'function stop@(v) { const c = new AbortController(); c.abort(v); return c.signal; }', 'return stop@(o).reason;'),
 'async-local-storage': (0, 'import { AsyncLocalStorage as Storage@ } from "node:async_hooks";\nconst store@ = new Storage@();\nfunction run@(v) { return store@.run(v, () => store@.getStore()); }', 'return run@(o);'),
 'event-emitter': (0, 'import { EventEmitter as Emitter@ } from "node:events";\nlet kept@;\nfunction send@(v) { const e = new Emitter@(); e.on("x", x => { kept@ = x; }); e.emit("x", v); }', 'send@(o); return kept@;'),
 'next-tick-argument': (1, 'function later@(v) { return new Promise(resolve => process.nextTick(resolve, v)); }', 'return await later@(o);'),
 'util-promisify': (1, 'import { promisify as promisify@ } from "node:util";\nfunction give@(v, done) { done(null, v); }', 'return await promisify@(give@)(o);'),
 'record-of-a-step-is-changed': (0, 'function step@(it) { return it.next(); }\nfunction read@(r) { return r.value; }', 'const r = step@([0].values()); r.value = o; return read@(r);'),
}
for name, (is_async, helpers, body) in cases.items():
    text = '// An object goes into a container and comes out of it (' + name.replace('-', ' ') + '). What comes out gets a field of another type, gains a property, loses one, gets an accessor, another prototype, or is frozen: whoever reads the object afterwards sees it.\n' + head
    for letter in 'ABCDEF':
        if helpers:
            text += helpers.replace('@', letter) + '\n'
        text += ('async ' if is_async else '') + 'function through%s(o) { %s }\n' % (letter, body.replace('@', letter))
    text += async_tail if is_async else sync_tail
    open(os.path.join(out, name + '.js'), 'w').write(text)
print(len(cases))

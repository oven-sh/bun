// Private methods and accessors of classes whose objects are born elsewhere without room in line for them: heirs of Promise, Map, Set, Error, Date, RegExp, Array, typed arrays, functions and
// objects handed back by a base constructor: with no storage out of line yet, with room left in it, and with none left. Each object keeps what it held, every method answers, a second stamp throws, and once
// warm a `new` of an heir of Promise, Map or Error asks the engine next to nothing about the methods. Only the jsc shell can count; elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
class Query extends Promise {
    #one() { return 1; } #two() { return 2; } #three() { return 3; } get #four() { return 4; }
    constructor(executor = resolve => resolve("done")) { super(executor); }
    static get [Symbol.species]() { return Promise; }
    sum() { return this.#one() + this.#two() + this.#three() + this.#four; }
    static is(x) { return [#one in x, #four in x].join(); }
}
class Single extends Promise { #only() { return "only"; } constructor() { super(() => {}); } only() { return this.#only(); } }
class Five extends Map { #a() { return "a"; } #b() { return "b"; } #c() { return "c"; } #d() { return "d"; } #e() { return "e"; } letters() { return this.#a() + this.#b() + this.#c() + this.#d() + this.#e() + this.size; } }
class Twelve extends Error {
    #a() { return 1; } #b() { return 2; } #c() { return 3; } #d() { return 4; } #e() { return 5; } #f() { return 6; } #g() { return 7; } #h() { return 8; } #i() { return 9; } #j() { return 10; } #k() { return 11; }
    set #l(x) { this.seen = x; } get #l() { return 12; }
    sum() { this.#l = "set"; return this.#a() + this.#b() + this.#c() + this.#d() + this.#e() + this.#f() + this.#g() + this.#h() + this.#i() + this.#j() + this.#k() + this.#l + this.seen + this.message; }
}
class Fields extends Set { before = "before"; #m() { return "m"; } #n() { return "n"; } #field = "field"; after = "after"; all() { return this.before + this.#m() + this.#n() + this.#field + this.after + this.size; } }
class Deeper extends Query { #five() { return 5; } #six() { return 6; } #seven() { return 7; } more() { return this.sum() + this.#five() + this.#six() + this.#seven(); } }
lines.push(new Query().sum(), Query.is(new Query()), Query.is(Promise.resolve(1)), new Single().only(), new Five([[1, 2]]).letters(), new Twelve("message").sum(), new Fields([1, 2, 3]).all(), new Deeper().more());
lines.push(Object.getOwnPropertyNames(new Query()).length, Reflect.ownKeys(new Five()).length, Object.keys(new Fields()).join(), Object.keys(new Twelve("x")).join());
function Returns(x) { return x; }
class Stamp extends Returns {
    #m1() { return 1; } #m2() { return 2; } #m3() { return 3; } #m4() { return 4; } #m5() { return 5; } #m6() { return 6; }
    static sum(x) { return x.#m1() + x.#m2() + x.#m3() + x.#m4() + x.#m5() + x.#m6(); }
}
class StampOne extends Returns { #z() { return "z"; } static z(x) { return x.#z(); } }
function withProperties(o, n) { for (let i = 0; i < n; i++) o["p" + i] = i; return o; }
const kinds = {
    promise: () => Promise.resolve(1), map: () => new Map([[1, 2]]), set: () => new Set([1]), weakMap: () => new WeakMap(), error: () => new RangeError("r"), date: () => new Date(5), regExp: () => /x/g,
    array: () => [1, 2, 3], holey: () => [1, , 3], doubles: () => [1.5], emptyArray: () => [], bytes: () => new Uint8Array([1, 2, 3]), floats: () => new Float64Array(2), view: () => new DataView(new ArrayBuffer(8), 2),
    buffer: () => new ArrayBuffer(4), func: () => function f() {}, arrow: () => () => 1, bound: () => (function () {}).bind(null), klass: () => class {}, plain: () => ({}), nullProto: () => Object.create(null),
    withElements: () => ({ 0: "a", 1: "b" }), boxed: () => new String("abc"), number: () => new Number(5), args: () => (function () { return arguments; })(1, 2), generator: () => (function* () {})(), proxy: () => new Proxy({}, {}),
    symbolObject: () => Object(Symbol.iterator),
};
function holds(name, o) {
    switch (name) {
    case "map": return o.get(1); case "set": return o.has(1); case "error": return o.message; case "date": return o.getTime(); case "regExp": return o.source + o.flags;
    case "array": case "holey": case "doubles": case "emptyArray": return o.length + ":" + o.join(); case "bytes": case "floats": return o.length + ":" + o.byteLength + ":" + o.buffer.byteLength + ":" + o.join();
    case "view": return o.byteOffset + ":" + o.byteLength + ":" + o.buffer.byteLength; case "buffer": return o.byteLength; case "boxed": return o.length + o.valueOf(); case "number": return o.valueOf();
    case "args": return o.length + ":" + o[1]; case "withElements": return o[0] + o[1]; case "func": return o.name + o.length; default: return typeof o;
    }
}
for (const name of Object.keys(kinds)) {
    const row = [];
    for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17]) {
        for (let round = 0; round < 3; round++) {
            const o = withProperties(kinds[name](), n);
            row.push(attempt(() => { new Stamp(o); new StampOne(o); o.later = n; return Stamp.sum(o) + StampOne.z(o) + holds(name, o) + (n ? o["p" + (n - 1)] : "") + o.later + attempt(() => new Stamp(o)); }));
        }
    }
    lines.push(name + " " + [...new Set(row)].join(" "));
}
lines.push(attempt(() => new Stamp(Object.freeze({}))), attempt(() => new Stamp(Object.preventExtensions(new Map()))), attempt(() => new Stamp(1)), attempt(() => Stamp.sum(new Map())));
const kept = [];
for (let i = 0; i < 300; i++) { new Query(); new Five(); new Twelve("w"); new Fields(); new Deeper(); }
const before = count("operationAOTPrivateMethodsAdd");
let check = 0;
for (let i = 0; i < 3000; i++) {
    const q = new Query(), f = new Five(), t = new Twelve("t"), d = new Deeper();
    if (i % 250 === 0) kept.push(q, f, t, d);
    check = (check + q.sum() + f.letters().length + t.sum().length + d.more()) % 100003;
}
lines.push("the engine is asked at most 150 times for 15000 additions: " + (count("operationAOTPrivateMethodsAdd") - before <= 150), check + " " + kept.map(x => x.more ? x.more() : x.sum ? x.sum() : x.letters()).join());
new Query().then(x => { lines.push(x); console.log(lines.join("\n")); });

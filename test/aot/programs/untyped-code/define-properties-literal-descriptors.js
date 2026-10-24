// Object.defineProperties(o, { a: { value: .., writable: true }, .. }) where the literals are written in the call: what is defined, in which order, what is left behind when a definition throws, what
// the call yields; on plain objects, heirs of Array and Promise, arrays, functions, proxies, frozen objects; over properties that are there already, of every kind. Literals the compiler may not take apart stand
// beside them: accessors, computed keys, keys that are indices, spreads, literals that are seen elsewhere. Once warm, the birth of an heir of Array that defines four properties over its fields asks the engine
// next to nothing. Only the jsc shell can count; elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) + (d.writable ? "w" : "-") : (d.get ? "g" : "-") + (d.set ? "s" : "-")) + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-"); }).join(" ");
function basic(o) { return Object.defineProperties(o, { count: { value: null, writable: true }, command: { value: "c", enumerable: true }, rows: { value: 3, configurable: true }, all: { value: o, writable: true, enumerable: true, configurable: true }, none: { writable: false } }); }
const first = {};
lines.push(basic(first) === first, show(basic({ before: 1 })).replace("[object Object]", "self"), show(basic([1, 2])).replace("1,2", "self"), attempt(() => basic(1)), attempt(() => basic(null)), attempt(() => basic(undefined)), attempt(() => basic("text")));
const log = [];
const note = x => { log.push(x); return x; };
function ordered(o) { return Object.defineProperties(note(o), { a: { value: note("a"), writable: true }, b: { value: note("b") }, c: { value: note("c"), enumerable: true } }); }
const traps = new Proxy({}, { defineProperty(target, key, descriptor) { log.push("define " + String(key) + " " + Object.keys(descriptor).join()); return Reflect.defineProperty(target, key, descriptor); }, getOwnPropertyDescriptor(target, key) { log.push("asked " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } });
ordered(traps);
lines.push(log.map(String).join("|"));
log.length = 0;
function throwsBetween(o) { return Object.defineProperties(o, { a: { value: 1 }, b: { value: (() => { throw new RangeError("b"); })() }, c: { value: 3 } }); }
const untouched = {};
lines.push(attempt(() => throwsBetween(untouched)), show(untouched) === "");
function three(o) { return Object.defineProperties(o, { x: { value: 1, writable: true }, y: { value: 2, writable: true }, z: { value: 3, writable: true } }); }
const fixedY = Object.defineProperty({}, "y", { value: "fixed" });
lines.push(attempt(() => three(fixedY)), show(fixedY), attempt(() => three(Object.freeze({}))), attempt(() => three(Object.preventExtensions({ x: 0 }))), show(three(Object.seal({ x: 0, y: 0, z: 0 }))));
const refuses = new Proxy({}, { defineProperty(target, key, descriptor) { return key === "y" ? false : Reflect.defineProperty(target, key, descriptor); } });
lines.push(attempt(() => three(refuses)), Reflect.ownKeys(refuses).join());
const kindsThere = {
    writable: () => ({ x: "old", y: "old", z: "old" }), hidden: () => Object.defineProperties({}, { x: { value: "old", writable: true, configurable: true }, y: { value: "old", writable: true }, z: { value: "old", configurable: true } }),
    accessors: () => ({ get x() { return 1; }, set y(v) {}, get z() { return 3; }, set z(v) {} }), fixedAccessor: () => Object.defineProperty({}, "x", { get() { return 1; } }), sameValue: () => Object.defineProperties({}, { x: { value: 1 }, y: { value: 2 }, z: { value: 3 } }),
    array: () => Object.assign([7], { x: 0 }), func: () => Object.assign(function f() {}, { y: 0 }), inherited: () => Object.create({ x: "up", set y(v) { lines.push("never"); } }), nullProto: () => Object.create(null),
};
for (const [name, make] of Object.entries(kindsThere)) for (let round = 0; round < 3; round++) { const o = make(); const outcome = attempt(() => three(o) === o); if (!round) lines.push(name + " " + outcome + " " + show(o)); }
function onLength(a) { return Object.defineProperties(a, { length: { value: 1 }, extra: { value: "e" } }); }
lines.push(show(onLength([1, 2, 3])), attempt(() => onLength(Object.freeze([1, 2]))), show(onLength({})));
function named(f) { return Object.defineProperties(f, { name: { value: "renamed" }, length: { value: 9 }, prototype: { value: null } }); }
lines.push(show(named(function original(a, b) {})), attempt(() => show(named(() => {}))), attempt(() => show(named(class K {}))));
function indices(o) { return Object.defineProperties(o, { b: { value: "b", enumerable: true }, 1: { value: "one", enumerable: true }, a: { value: "a", enumerable: true }, 0: { value: "zero", enumerable: true } }); }
const orderOfIndices = [];
indices(new Proxy({}, { defineProperty(target, key, descriptor) { orderOfIndices.push(key); return Reflect.defineProperty(target, key, descriptor); } }));
lines.push(orderOfIndices.join(), show(indices([])), attempt(() => show(indices(new Uint8Array(1)))));
const symbol = Symbol("s"), key = "computed";
function others(o, flag, more) {
    Object.defineProperties(o, { [key]: { value: 1 }, [symbol]: { value: 2, enumerable: true } });
    Object.defineProperties(o, { got: { get() { return "got"; }, enumerable: true }, both: { get() { return 1; }, set(v) {}, configurable: true } });
    Object.defineProperties(o, { flagged: { value: 3, writable: flag, enumerable: !flag } });
    Object.defineProperties(o, { ...more, last: { value: "last" } });
    Object.defineProperties(o, { ["__proto__"]: { value: "own", enumerable: true } });
    Object.defineProperties(o, {});
    const shared = { value: "shared", enumerable: true };
    Object.defineProperties(o, { one: shared, two: shared });
    const outer = { kept: { value: "kept" } };
    Object.defineProperties(o, outer);
    outer.kept.value = "changed";
    Object.defineProperties(o, { twice: { value: 1, configurable: true }, twice: { value: 2, configurable: true } });
    Object.defineProperties(o, { odd: { value: 1, unknown: true, writable: 1 } });
    return o;
}
lines.push(show(others({}, true, { spread: { value: "spread" } })), show(others({}, false, null)));
lines.push(attempt(() => Object.defineProperties({}, { bad: { value: 1, get() {} } })), attempt(() => Object.defineProperties({}, { bad: { get: 1 } })), attempt(() => Object.defineProperties({}, { ok: { value: 1 }, bad: 5 })), attempt(() => Object.defineProperties({}, { bad: null })));
const partly = {};
lines.push(attempt(() => Object.defineProperties(partly, { ok: { value: 1 }, bad: { set: "no function" } })), show(partly) === "");
class Rows extends Array {
    count; command; lastInsertRowid; affectedRows;
    constructor(values = []) {
        super(...values);
        Object.defineProperties(this, { count: { value: null, writable: true }, command: { value: null, writable: true }, lastInsertRowid: { value: null, writable: true }, affectedRows: { value: null, writable: true } });
    }
    static get [Symbol.species]() { return Array; }
}
class Hidden extends Array { constructor() { super(); Object.defineProperties(this, { count: { value: 0, writable: true }, command: { value: "", writable: true } }); } }
class Later extends Promise { constructor() { super(() => {}); Object.defineProperties(this, { state: { value: "new", writable: true }, id: { value: 7 } }); } }
function made() { const o = Object.defineProperties({}, { a: { value: 1, writable: true }, b: { value: 2, enumerable: true }, c: { value: 3 } }); o.d = 4; return o; }
function Plain() { Object.defineProperties(this, { a: { value: 1, writable: true }, b: { value: 2, enumerable: true }, c: { value: 3 } }); this.d = 4; }
lines.push(show(new Rows([1, 2])), Object.keys(new Rows(["x"])).join(), show(new Hidden()), show(new Later()), show(new Plain()), JSON.stringify(new Plain()));
for (let i = 0; i < 300; i++) { new Rows(); new Hidden(); new Later(); new Plain(); made(); }
const names = ["operationAOTDefineOwnProperty"];
const asked = () => names.reduce((sum, name) => sum + count(name), 0);
function apart(o) { return Object.defineProperties(o, { p: { value: 1 }, q: { value: 2 } }); }
const untilNow = asked();
lines.push(show(apart({})), "each definition is carried out by itself: " + (typeof aotOperationCount !== "function" || asked() - untilNow === 2));
const before = asked();
let check = 0;
const kept = [];
for (let i = 0; i < 3000; i++) {
    const r = new Rows([i, i + 1]), p = made();
    r.count = i; r.command = "SELECT";
    if (i % 500 === 0) kept.push(r, p);
    check = (check + r.length + r.count + r[1] + p.a + p.b + p.c + p.d) % 100003;
}
lines.push("the engine is asked at most 60 times for 21000 definitions: " + (asked() - before <= 60), check + " " + kept.map(show).join(" / "));
console.log(lines.join("\n"));

// x.get(k), x.has(k), x.set(k, v), x.add(k) where nothing says what x is: a Map, a Set, a WeakMap, a WeakSet, an heir of one, one with a method of its own or another prototype, a frozen one,
// and objects of the program's own that have methods of these names. Keys: objects, symbols, primitives; there, not there, deleted, put back; enough of them that the tables grow.
const lines = [];
function get(x, k) { return x.get(k); }
function has(x, k) { return x.has(k); }
function set(x, k, v) { return x.set(k, v); }
function add(x, k) { return x.add(k); }
function attempt(f, ...rest) { try { return show(f(...rest)); } catch (error) { return error.constructor.name; } }
const names = new Map;
function show(v) {
    if (names.has(v)) return names.get(v);
    if (typeof v === "symbol") return v.toString();
    if (typeof v === "function") return "a function";
    if (typeof v === "object" && v) return "{" + Object.keys(v).join() + "}";
    return String(v);
}
const a = { a: 1 }, b = { b: 1 }, c = function () {}, lone = Symbol("lone"), registered = Symbol.for("registered");
class OwnTable { constructor() { this.held = []; } get(k) { return "own get " + show(k); } has(k) { return this.held.includes(k); } set(k, v) { this.held.push(k); return v; } add(k) { this.held.push(k); return this.held.length; } }
class HeirOfWeakMap extends WeakMap { get(k) { return "heir: " + show(super.get(k)); } }
class PlainHeirOfWeakMap extends WeakMap {}
class HeirOfMap extends Map {}
const withOwnMethod = new WeakMap; withOwnMethod.get = function (k) { return "own property"; };
const withOtherPrototype = Object.setPrototypeOf(new WeakMap, { get() { return "other prototype"; }, has() { return "other has"; }, set() { return "other set"; } });
const withNoPrototype = Object.setPrototypeOf(new WeakMap, null);
const frozen = Object.freeze(new WeakMap);
const tables = { map: new Map, set: new Set, weakMap: new WeakMap, weakSet: new WeakSet, own: new OwnTable, heir: new HeirOfWeakMap, plainHeir: new PlainHeirOfWeakMap, heirOfMap: new HeirOfMap,
    withOwnMethod, withOtherPrototype, withNoPrototype, frozen, plain: {}, array: [], text: "text", number: 5, nothing: undefined };
for (const [name, table] of Object.entries(tables)) if (typeof table === "object" && table) names.set(table, "<" + name + ">");
const keys = [a, b, c, lone, registered, "a", 1, 1.5, NaN, -0, null, undefined, true, 10n];
for (const [name, table] of Object.entries(tables)) {
    const row = [name];
    for (let round = 0; round < 2; round++) {
        for (const k of keys) row.push(attempt(get, table, k) + "/" + attempt(has, table, k));
        for (const k of keys) row.push(attempt(set, table, k, round + ":" + show(k)) + "/" + attempt(add, table, k));
    }
    for (const k of keys) row.push(attempt(get, table, k) + "/" + attempt(has, table, k));
    lines.push(row.join(" "));
}
const weak = new WeakMap, weakSet = new WeakSet, strong = new Map, many = [];
for (let i = 0; i < 3000; i++) many.push({ i });
let sum = 0;
for (let i = 0; i < many.length; i++) { if (set(weak, many[i], i) !== weak || add(weakSet, many[i]) !== weakSet || set(strong, many[i], -i) !== strong) sum += 1e9; }
for (let i = 0; i < many.length; i += 3) { weak.delete(many[i]); weakSet.delete(many[i]); strong.delete(many[i]); }
for (let i = 0; i < many.length; i++) sum += (get(weak, many[i]) ?? 7) + (has(weak, many[i]) ? 1 : 0) + (has(weakSet, many[i]) ? 2 : 0) + (get(strong, many[i]) ?? 11) + (has(strong, many[i]) ? 4 : 0);
for (let i = 0; i < many.length; i += 6) { set(weak, many[i], "back"); add(weakSet, many[i]); }
let back = 0;
for (let i = 0; i < many.length; i++) back += (get(weak, many[i]) === "back" ? 1 : 0) + (has(weakSet, many[i]) ? 1 : 0);
lines.push(sum + " " + back);
for (let round = 0; round < 40; round++) { const young = []; for (let i = 0; i < 200; i++) { const o = { round, i }; young.push(o); set(weak, o, o); } for (const o of young) if (get(weak, o) !== o) sum = -1; }
lines.push(String(sum), String(get(weak, many[1])), String(get(weak, {})), String(has(weakSet, {})));
console.log(lines.join("\n"));

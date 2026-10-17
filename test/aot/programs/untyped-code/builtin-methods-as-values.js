// Built-in methods of strings, maps, sets and weak tables that are not called as x.name(..) on the spot: read first and called later, called in tail position, through call, apply, bind and
// Reflect.apply, handed on as values: with receivers and arguments they serve and with those they refuse.
const lines = [];
function attempt(f) { try { const v = f(); return typeof v === "object" && v ? "[" + v.constructor.name + "]" : String(v); } catch (error) { return error.constructor.name; } }
const startsWith = String.prototype.startsWith, indexOf = String.prototype.indexOf;
const mapGet = Map.prototype.get, mapHas = Map.prototype.has, mapSet = Map.prototype.set, setHas = Set.prototype.has, setAdd = Set.prototype.add;
const weakGet = WeakMap.prototype.get, weakHas = WeakMap.prototype.has, weakSet = WeakMap.prototype.set, weakSetHas = WeakSet.prototype.has;
function glue(a, b) { return a + b; }
const wide = "abcdefĀ";
const texts = ["", "a", "abc", "abcdef", glue("ab", "cdef"), glue(glue("a", "b"), "c"), wide, wide.slice(0, 3), wide.slice(2, 5), "Ā", "undefined", "null", "12", "1"];
const others = [undefined, null, 1, 12, 1.5, true, {}, [], ["a"], /a/, new String("a"), { toString() { return "ab"; } }, Symbol.iterator, 10n];
const inTail = (s, t) => s.startsWith(t);
const placeInTail = (s, t) => s.indexOf(t);
function readFirst(s, t, u) { const f = s.startsWith, g = s.indexOf; const x = glue(t, u); return f.call(s, x) + "," + g.call(s, x); }
let row = [];
for (const s of texts) for (const t of texts) row.push((inTail(s, t) ? 1 : 0) + ":" + placeInTail(s, t) + ":" + readFirst(s, t, ""));
lines.push(row.join(" "));
row = [];
for (const s of texts.slice(0, 6)) for (const t of others) row.push(attempt(() => inTail(s, t)) + ":" + attempt(() => placeInTail(s, t)) + ":" + attempt(() => startsWith.call(s, t)) + ":" + attempt(() => indexOf.call(s, t)));
lines.push(row.join(" "));
row = [];
for (const s of others) for (const t of ["", "a", "1", "u", "[", "t"]) row.push(attempt(() => startsWith.call(s, t)) + ":" + attempt(() => indexOf.call(s, t)) + ":" + attempt(() => Reflect.apply(startsWith, s, [t])) + ":" + attempt(() => indexOf.apply(s, [t])));
lines.push(row.join(" "));
lines.push([attempt(() => startsWith.call("abc")), attempt(() => indexOf.call("undefined")), attempt(() => startsWith.call("abc", "b", 1)), attempt(() => indexOf.call("abcabc", "c", 3)), attempt(() => startsWith.bind("abc")("ab")), attempt(() => indexOf.bind("abc", "c")())].join());
const a = {}, b = [], c = () => 1, lone = Symbol("lone");
class HeirOfMap extends Map {} class HeirOfWeakMap extends WeakMap {} class HeirOfSet extends Set {}
const receivers = [new Map([[a, 1], ["k", 2], [1, 3]]), new HeirOfMap([[a, 4]]), new Set([a, "k", 1]), new HeirOfSet([a]), new WeakMap([[a, 5], [c, 6]]), new HeirOfWeakMap([[a, 7]]), new WeakSet([a, b]), {}, [], "text", 1, null, undefined, Object.create(Map.prototype), Object.create(WeakMap.prototype)];
const keys = [a, b, c, lone, "k", 1, 1.0, NaN, undefined, null];
for (const [name, f, count] of [["mapGet", mapGet, 1], ["mapHas", mapHas, 1], ["mapSet", mapSet, 2], ["setHas", setHas, 1], ["setAdd", setAdd, 1], ["weakGet", weakGet, 1], ["weakHas", weakHas, 1], ["weakSet", weakSet, 2], ["weakSetHas", weakSetHas, 1]]) {
    row = [name];
    for (const r of receivers) for (const k of keys) row.push(count === 1 ? attempt(() => f.call(r, k)) : attempt(() => f.call(r, k, name)));
    lines.push(row.join(" "));
}
const table = receivers[4];
const getOfTable = k => table.get(k), hasOfTable = k => table.has(k), setOfTable = (k, v) => table.set(k, v);
lines.push([getOfTable(a), getOfTable(b), hasOfTable(c), hasOfTable(lone), setOfTable(b, 9) === table, getOfTable(b), attempt(() => setOfTable(1, 1)), attempt(() => setOfTable(Symbol.for("registered"), 1)), attempt(() => setOfTable(lone, 2) === table), getOfTable(lone)].join());
console.log(lines.join("\n"));

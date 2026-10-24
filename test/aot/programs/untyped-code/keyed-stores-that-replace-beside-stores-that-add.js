// `o[key] = value` on a plain object either replaces a property or adds one; which of the two is remembered for a shape and a key in one table. What is remembered for a replacement never answers for a definition under that key (`{ [key]: value }` gives the property its default attributes anew), a change above the object is seen by the stores that add, and neither kind of store takes work anew once it is known.
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTPutByValGeneric") + counted("operationAOTPutByValAndCache") + counted("operationAOTPutByValAndCacheSloppy") : 0;
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(",");
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const mark = Symbol("mark");
const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", mark];

function fill(keys, from) { const out = {}; for (let i = 0; i < keys.length; i++) out[keys[i]] = from + i; return out; }
function refill(out, keys, from) { for (let i = 0; i < keys.length; i++) out[keys[i]] = from + i; return out; }
for (let turn = 0; turn < 4; turn++) lines.push("filled: " + show(fill(names, turn)));
const kept = fill(names, 0);
for (let turn = 0; turn < 4; turn++) lines.push("filled again: " + show(refill(kept, names, 10 * turn)));
for (let length = 0; length <= names.length; length += 3) lines.push("so many: " + show(refill(fill(names.slice(0, length), 1), names.slice(0, length), 2)));
const before = entered();
let sum = 0;
for (let turn = 0; turn < 2000; turn++) sum += refill(fill(names, turn), names, turn + 1).n;
lines.push("sum " + sum, "operations entered once everything is known: " + (entered() - before));

function twice(k, v) { const o = { p: 1, q: 2 }; o[k] = v; o[k] = v + 1; return o; }
function among(k, v) { return { p: 1, q: 2, [k]: v }; }
for (let turn = 0; turn < 6; turn++) for (const k of ["p", "q", "r", mark]) lines.push("stored twice, then defined " + String(k) + ": " + show(twice(k, turn)) + " | " + show(among(k, turn)));

function hidden() { const o = { p: 1 }; Object.defineProperty(o, "q", { value: 2, writable: true, enumerable: false, configurable: false }); return o; }
function store(o, k, v) { o[k] = v; return o; }
function copyUnder(o, k, v) { return Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); }
for (let turn = 0; turn < 6; turn++) lines.push("not listed, not deletable, written: " + show(store(hidden(), "q", turn)) + " | " + attempt(() => show(copyUnder(hidden(), "q", turn))));

function fixed() { const o = { p: 1 }; Object.defineProperty(o, "q", { value: 2, writable: false, enumerable: true, configurable: true }); return o; }
for (let turn = 0; turn < 6; turn++) lines.push("read-only: " + attempt(() => show(store(fixed(), "q", turn))) + " | " + show(store(fixed(), "p", turn)) + " | frozen: " + attempt(() => show(store(Object.freeze({ p: 1, q: 2 }), "q", turn))) + " | " + attempt(() => show(store(Object.freeze({ p: 1, q: 2 }), "r", turn))) + " | sealed: " + show(store(Object.seal({ p: 1, q: 2 }), "q", turn)) + " " + attempt(() => show(store(Object.seal({ p: 1, q: 2 }), "r", turn))));

const calls = [];
function withAccessor() { return { p: 1, get q() { return "got"; }, set q(v) { calls.push("own setter " + v); } }; }
for (let turn = 0; turn < 6; turn++) lines.push("own accessor: " + show(store(withAccessor(), "q", turn)));

const above = {};
function under() { return { __proto__: above, p: 1 }; }
for (let turn = 0; turn < 6; turn++) lines.push("before the change above: " + show(store(under(), "z", turn)) + " | " + show(store(store(under(), "z", turn), "z", turn + 1)));
Object.defineProperty(above, "z", { set(v) { calls.push("setter above " + v); }, configurable: true });
for (let turn = 0; turn < 6; turn++) lines.push("a setter above: " + show(store(under(), "z", turn)));
Object.defineProperty(above, "z", { value: "fixed above", writable: false, configurable: true });
for (let turn = 0; turn < 6; turn++) lines.push("read-only above: " + attempt(() => show(store(under(), "z", turn))));
delete above.z;
for (let turn = 0; turn < 6; turn++) lines.push("nothing above again: " + show(store(under(), "z", turn)));
const had = store(under(), "z", 1);
Object.defineProperty(above, "z", { set(v) { calls.push("never for an own property " + v); }, configurable: true });
for (let turn = 0; turn < 6; turn++) lines.push("its own stays its own: " + show(store(had, "z", turn)));
lines.push(calls.join("; "));

function removeAndStore(k) { const o = { p: 1, q: 2, r: 3 }; o[k] = 4; delete o[k]; o[k] = 5; o[k] = 6; return o; }
for (let turn = 0; turn < 6; turn++) for (const k of ["p", "r", "s"]) lines.push("deleted between: " + show(removeAndStore(k)));

function onFunction(k, v) { const f = function () {}; f[k] = v; f[k] = v + 1; return f; }
function onArray(k, v) { const a = [1, 2]; a[k] = v; a[k] = v + 1; return a; }
class Point { constructor() { this.x = 1; this.y = 2; } }
for (let turn = 0; turn < 6; turn++) for (const k of ["x", "extra", mark]) lines.push("other receivers " + String(k) + ": " + show(onFunction(k, turn)) + " | " + show(onArray(k, turn)) + " | " + show(store(store(new Point, k, turn), k, turn + 1)));

const many = {};
for (let i = 0; i < 3000; i++) many["name" + i] = i;
let total = 0;
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 3000; i += 7) { many["name" + i] = i + turn; total += many["name" + i]; }
lines.push("a large table: " + total + " " + Object.keys(many).length);
console.log(lines.join("\n"));

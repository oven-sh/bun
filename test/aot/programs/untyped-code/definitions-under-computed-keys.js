// `{ [key]: value }`, class fields under computed keys and Object.fromEntries define an own property whatever the object inherits. A definition that is remembered for a shape and a key never answers for a store under that key, which asks the prototype chain, nor the other way round; and defining under the same few keys over and over takes no work anew.
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTToKey") + counted("operationAOTDefineField") : 0;
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(",");
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const mark = Symbol("mark");
function one(k, v) { return { [k]: v }; }
function among(k, v) { return { p: 1, [k]: v, q: 2 }; }
function two(k, l) { return { [k]: 1, [l]: 2 }; }
function behindAccessor(k) { return { get a() { return "got"; }, set a(v) { lines.push("the setter of the literal ran"); }, [k]: 5 }; }
const keys = ["a", "b", "p", "q", "__proto__", "constructor", "toString", mark, Symbol.iterator, 0, 7, -1, 1.5, "3", "", "a b", null, undefined, true, 10n, ["x", "y"], { toString() { return "made"; } }];
for (let turn = 0; turn < 3; turn++) for (const k of keys) lines.push(turn + " " + String(typeof k === "symbol" ? k.toString() : k) + " | " + show(one(k, 1)) + " | " + show(among(k, 3)) + " | " + show(two(k, "b")) + " | " + show(two("b", k)) + " | " + show(behindAccessor(k)));
lines.push("the prototype stays: " + (Object.getPrototypeOf(one("__proto__", null)) === Object.prototype) + " " + (Object.getPrototypeOf(one("__proto__", {})) === Object.prototype));
lines.push(attempt(() => ({ [{ toString() { throw new RangeError("no key"); } }]: 1 })), attempt(() => ({ [Object.create(null)]: 1 })));

const calls = [];
const watching = { set x(v) { calls.push("set x " + v); }, get x() { return "inherited"; } };
Object.defineProperty(watching, "fixed", { value: "cannot be written", writable: false, enumerable: true, configurable: true });
function defined(k, v) { return { __proto__: watching, [k]: v }; }
function stored(k, v) { const o = { __proto__: watching }; o[k] = v; return o; }
const names = ["x", "fixed", "free"];
for (let turn = 0; turn < 6; turn++) for (const k of names) lines.push("defined then stored " + k + ": " + show(defined(k, turn)) + " | " + attempt(() => show(stored(k, turn))));
for (let turn = 0; turn < 6; turn++) for (const k of names) lines.push("stored then defined " + k + ": " + attempt(() => show(stored(k, turn))) + " | " + show(defined(k, turn)));
lines.push(calls.length + " calls of the setter");
const late = {};
function definedLate(k, v) { return { __proto__: late, [k]: v }; }
function storedLate(k, v) { const o = { __proto__: late }; o[k] = v; return o; }
for (let turn = 0; turn < 5; turn++) lines.push("before: " + show(definedLate("z", turn)) + " | " + show(storedLate("z", turn)));
Object.defineProperty(late, "z", { set(v) { calls.push("late " + v); }, configurable: true });
for (let turn = 0; turn < 5; turn++) lines.push("behind: " + show(definedLate("z", turn)) + " | " + show(storedLate("z", turn)));
lines.push(calls.length + " calls of the setters");

const field = "x", other = "fixed", hidden = "hidden";
class Root { set x(v) { calls.push("set x of Root " + v); } get x() { return "inherited"; } get fixed() { return "cannot be written"; } }
class Base extends Root { constructor(freeze) { super(); if (freeze === "hide") Object.defineProperty(this, "hidden", { value: 0, writable: true, enumerable: false, configurable: true }); if (freeze === "freeze") Object.freeze(this); if (freeze === "close") Object.preventExtensions(this); } }
class Heir extends Base { [field] = 1; [other] = 2; [hidden] = 3; [mark] = 4; }
for (let turn = 0; turn < 4; turn++) lines.push("fields: " + show(new Heir()) + " | " + show(new Heir("hide")) + " | " + attempt(() => show(new Heir("freeze"))) + " | " + attempt(() => show(new Heir("close"))));

const pairs = [[["a", 1], ["b", 2]], [["a", 1], ["a", 2]], [["__proto__", 1], [mark, 2], [0, 3], ["x", 4]], [], [[{ toString() { return "made"; } }, 1]], [["a"]], [[]]];
for (let turn = 0; turn < 3; turn++) for (const list of pairs) lines.push("fromEntries " + show(Object.fromEntries(list)));
lines.push("fromEntries " + show(Object.fromEntries(new Map([["m", 1], [mark, 2]]))) + " " + show(Object.fromEntries((function* () { yield ["g", 1]; yield ["h", 2]; })())) + " " + attempt(() => Object.fromEntries([1])) + " " + attempt(() => Object.fromEntries(null)));

const few = ["alpha", "beta", "gamma", mark];
for (let i = 0; i < 12; i++) { one(few[i % 4], i); among(few[i % 4], i); two(few[i % 4], few[(i + 1) % 4]); }
const before = entered();
let sum = 0;
for (let i = 0; i < 3000; i++) sum += one(few[i % 4], 1)[few[i % 4]] + among(few[i % 4], 2).q + two(few[i % 4], few[(i + 1) % 4])[few[(i + 1) % 4]];
lines.push(sum + " " + (counted ? entered() - before < 100 : true));
console.log(lines.join("\n"));

// `{ name: value, [key]: value }`: the key is made a property key once, and the property is defined, whatever lies above the object. A key that is an index, or the text of one, names an element.
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message; } };
const listed = object => Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join(" ");
function say(label, value) { console.log(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const beside = (key, value) => ({ name: "n", [key]: value });
const alone = (key, value) => ({ [key]: value });
const between = (key, value) => ({ first: 1, [key]: value, last: 3 });
const two = (a, b, value) => ({ name: "n", [a]: value, [b]: value + 1 });
const symbol = Symbol("s");
const keys = [0, 1, 7, 8, 9, 100, 9999, 10000, 4294967294, 4294967295, 4294967296, -1, -0, 1.5, NaN, Infinity, 1e21, "0", "1", "7", "8", "01", "1.0", "-1", "9999", "10000", "4294967294", "4294967295", " 1", "1 ", "", "name", "first", "last", "__proto__", "constructor", "length", "two", symbol, Symbol.iterator, true, null, undefined, 10n, [3], ["a", "b"], { toString() { return "made"; } }, { toString() { return "5"; } }, { valueOf() { return 1; }, toString: null }];
for (let round = 0; round < 3; round++) {
  for (const key of keys) say("beside " + (typeof key === "symbol" ? String(key) : typeof key + " " + String(key)), [listed(beside(key, "v")), listed(alone(key, "v")), listed(between(key, 2))].join(" ; "));
  say("two keys", [[0, 1], [1, 0], [0, 0], ["0", 0], [0, "0"], ["a", "a"], ["name", "name"], [5, "x"], ["x", 5], [symbol, symbol], [8, 2], [2, 8], [100000, 1]].map(([a, b]) => listed(two(a, b, 1))));
  say("each key is made a text once, in the order written", (() => { const made = { [{ toString() { log.push("first"); return "k"; } }]: 1, [{ toString() { log.push("second"); return "2"; } }]: 2, [{ toString() { log.push("third"); return "k"; } }]: 3 }; return listed(made); })());
  say("a key that throws", told(() => ({ name: 1, [{ toString() { throw new RangeError("no key"); } }]: 2 })));
  say("a key that is a symbol made a text", told(() => ({ ["" + symbol]: 1 })));
  say("what is defined can be changed", [0, "0", "x", symbol].map(key => { const descriptor = Object.getOwnPropertyDescriptor(beside(key, 1), key); return [descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable].join(); }));
  say("a setter above is not asked", (() => { const above = { set 0(value) { log.push("set 0"); }, set x(value) { log.push("set x"); }, get 1() { return "above"; } }; const made = { __proto__: above, [0]: "own", ["x"]: "own", [1]: "own", ["1" + ""]: "again" }; return listed(made); })());
  say("accessors and methods under keys", (() => { const k = 3, made = { get [k]() { return "got"; }, set [k](value) { log.push("set " + value); }, [k + 1]() { return "called"; }, get ["t" + k]() { return "got text"; } }; made[3] = 5; return [made[3], made[4](), made[4].name, made.t3, Object.keys(made).join()]; })());
  say("functions take their name from the key", [0, "0", "x", symbol, 1.5].map(key => ({ [key]: function () { } })[key].name + "|" + ({ [key]: () => { } })[key].name + "|" + ({ [key]: class { } })[key].name));
  say("a spread behind and in front", (() => { const k = 1; return [listed({ [k]: "a", ...{ 1: "b", 0: "c" } }), listed({ ...{ 1: "b", 0: "c" }, [k]: "a" }), listed({ ...[7, 8], [k]: "a" })]; })());
  say("many elements", (() => { const made = { name: "n" }; const other = { name: "n", [0]: 0, [1]: 1, [2]: 2, [3]: 3, [4]: 4, [5]: 5, [6]: 6, [7]: 7, [8]: 8, [9]: 9, [10]: 10 }; for (let i = 0; i < 12; i++) Object.assign(made, { [i]: i }); return [listed(made), listed(other)]; })());
  say("values of every kind under an index", [1, 1.5, "text", null, undefined, true, symbol, 10n, {}, [], () => { }].map(value => typeof beside(0, value)[0] + " " + typeof alone("0", value)[0]));
  say("read again by the other form", [0, 5, 9999].map(index => [beside(index, "v")[String(index)], beside(String(index), "v")[index], index in beside(String(index), 1), String(index) in beside(index, 1), Object.hasOwn(alone(String(index), 1), index)]));
  say("frozen, sealed and measured afterwards", (() => { const made = Object.freeze(beside(0, 1)); return [told(() => { "use strict"; made[0] = 2; return made[0]; }), Object.isFrozen(made), JSON.stringify(made), Object.entries(beside("2", "v")).join(";")]; })());
  say("classes", (() => { const k = 0, t = "1"; class Keyed { [k] = "field"; [t] = "text field"; static [k] = "static"; [k + 2]() { return "method"; } } const made = new Keyed; return [listed(made), Keyed[0], made[2]()]; })());
}
let sum = 0;
const mixed = [0, 1, "two", 3, "4", symbol, 5.5, "name"];
for (let i = 0; i < 60000; i++) { const key = mixed[i & 7]; sum += beside(key, i)[key] + alone(key, 1)[key] + between(key, 2).last; }
console.log(sum);

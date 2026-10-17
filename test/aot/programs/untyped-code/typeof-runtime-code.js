// Functions made at run time ask typeof of values of every kind, compared with each of its answers and as a value.
const lines = [];
const answers = ["undefined", "object", "function", "string", "number", "boolean", "symbol", "bigint", "nothing"];
const is = {}, isNot = {}, branch = {};
for (const answer of answers) {
  is[answer] = new Function("value", "return typeof value === '" + answer + "';");
  isNot[answer] = new Function("value", "return typeof value != '" + answer + "';");
  branch[answer] = new Function("value", "if (typeof value == '" + answer + "') return 1; return 0;");
}
const plain = new Function("value", "return typeof value;");
const validator = new Function("data", "return !!(data && typeof data == 'object' && !Array.isArray(data));");
class Callable extends Function {}
function declared() {}
const values = () => [
  undefined, null, true, false, 0, 1.5, NaN, "", "text", "a" + lines.length, Symbol("s"), 10n, {}, [], Object.create(null), new Date(0), /x/, new Map(), new Proxy({}, {}), new Proxy(function () {}, {}), new Proxy(class {}, {}),
  declared, () => 1, async () => 1, function* () {}, class {}, class extends Map {}, declared.bind(null), Math.max, Object, Map, Proxy, Symbol, BigInt, new Callable(), Function.prototype, Object.prototype, parseInt, JSON, Math, Reflect, globalThis,
  new String("s"), new Number(1), new Boolean(false), Object(Symbol.iterator), Object(1n), new Uint8Array(1), new ArrayBuffer(1), new Error("e"), Promise.resolve(1), new WeakMap(), (function () { return arguments; })(), plain, is.object,
];
for (let round = 0; round < 3; round++) {
  values().forEach((value, index) => {
    lines.push(index + " " + plain(value) + " " + answers.map(answer => (is[answer](value) ? "1" : "0") + (isNot[answer](value) ? "1" : "0") + branch[answer](value)).join(" ") + " " + validator(value));
  });
}
let count = 0;
const mixed = values();
for (let turn = 0; turn < 60000; turn++) {
  const value = mixed[turn % mixed.length];
  if (is.object(value)) count += 1;
  if (is.function(value)) count += 1000;
  if (validator(value)) count += 1000000;
}
lines.push("count " + count);
console.log(lines.join("\n"));

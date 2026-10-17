const values = [
  0, -0, 1, -1, 2147483647, -2147483648, 2147483648, -2147483649, 4294967296, 9007199254740991, -9007199254740991, 9007199254740992, -9007199254740992,
  0.5, -0.5, 1.0000000000000002, 1e21, -1e21, 1e308, 5e-324, Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON,
  NaN, -NaN, Infinity, -Infinity,
  undefined, null, true, false, "", "1", "NaN", "Infinity", " 12 ", 1n, 0n, Symbol.iterator,
  {}, [], [1], [NaN], () => 1, new Number(1), new Number(NaN), new Date(0), /x/,
  { valueOf() { throw new Error("valueOf must not run"); } },
  { [Symbol.toPrimitive]() { throw new Error("toPrimitive must not run"); } },
];

function describe(value) {
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return Object.is(value, -0) ? "-0" : String(value);
}

function ask(value) {
  return [Number.isNaN(value), Number.isFinite(value), Number.isInteger(value), Number.isSafeInteger(value)].map(answer => (answer ? "T" : "f")).join("");
}

for (const value of values) console.log(describe(value), ask(value));

function countSafe(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    if (Number.isSafeInteger(list[i])) count++;
    if (!Number.isNaN(list[i]) && Number.isFinite(list[i]) && !Number.isInteger(list[i])) count += 100;
  }
  return count;
}
console.log(countSafe(values));

const parsed = JSON.parse('{"a":1,"b":1.5,"c":"1","d":null,"e":1e400,"f":-0,"g":9007199254740993,"h":[2]}');
for (const key in parsed) console.log(key, ask(parsed[key]));

console.log(Number.isNaN(), Number.isFinite(), Number.isInteger(), Number.isSafeInteger());
console.log(Number.isNaN(NaN, 1), Number.isFinite(1, "x"), Number.isInteger(1.5, 1), Number.isSafeInteger(2 ** 53, 1));

function viaBranch(value) {
  if (Number.isInteger(value)) return "integer";
  if (Number.isFinite(value)) return "finite";
  if (Number.isNaN(value)) return "nan";
  return typeof value;
}
console.log(values.map(viaBranch).join(" "));

// `+value`, `Number(value)` of a value of which nothing is known: a number is itself and a boolean is 0 or 1: a stub says so: the runtime is entered for the rest alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function plus(value) { return +value; }
function twice(value) { return +value * 2; }
var calls = 0, object = { valueOf: function () { calls++; return 7; } };
var values = [0, -0, 1, -1, 2147483647, -2147483648, 4294967296, 0.5, -1.5, NaN, Infinity, -Infinity, true, false, null, undefined, "", " ", "12", "1e3", "0x10", "x", [], [5], [1, 2], {}, object, new Boolean(true), new Number(3), function () {}];
console.log(values.map(function (value) { return Object.is(plus(value), -0) ? "-0" : String(plus(value)); }).join());
console.log(values.map(function (value) { return twice(value); }).join(), calls);
for (var value of [1n, Symbol.iterator, { valueOf: function () { throw new RangeError("asked"); } }, Object.create(null)]) { try { console.log(plus(value)); } catch (error) { console.log(error.name); } }
var simple = [true, false, 1, 2.5, -0, NaN, 1073741824, true], before = count("operationAOTToNumber"), sum = 0;
for (var i = 0; i < 1000; i++) { var n = plus(simple[i & 7]); if (n === n) sum += n; }
console.log(sum, count("operationAOTToNumber") - before);

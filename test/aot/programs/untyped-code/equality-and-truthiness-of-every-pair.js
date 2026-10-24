// Every kind of value against every other under `===`, `==` and `!==`, every kind under each truthiness test, and which of them stay out of the runtime.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const one = process.argv.length > 0 ? 1 : 0;
const rope = "abcdefghij".repeat(4) + String(one);
const wide = String.fromCharCode(0x20ac);
const values = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, 2 ** 31, "", "a", String.fromCharCode(97), rope, wide, 0n, 1n, 2n ** 70n, Symbol(), {}, [], function () {}, { valueOf() { return 1; } }];

function bits(test) { return values.map(right => (test(right) ? 1 : 0)).join(""); }
for (const left of values)
  console.log(bits(right => left === right), bits(right => left == right), bits(right => left !== right));
function isTrueByBranch(value) { if (value) return true; return false; }
console.log(bits(value => !!value), bits(value => (value ? 1 : 0)), bits(isTrueByBranch));

const isBigInt = value => typeof value === "bigint";
const isString = value => typeof value === "string";
const isMixedWidth = (left, right) => isString(left) && isString(right) && (left === wide) !== (right === wide);
const pairs = values.flatMap(left => values.map(right => [left, right]));
const strictPairs = pairs.filter(([left, right]) => !isBigInt(left) && !isBigInt(right) && !isMixedWidth(left, right));
const looseInStub = ([left, right]) =>
  (typeof left === "number" && typeof right === "number") || (isString(left) && isString(right) && !isMixedWidth(left, right)) || (Object.is(left, right) && !isBigInt(left) && Object(left) !== left);
const loosePairs = pairs.filter(looseInStub);
const truthyValues = values.filter(value => !isBigInt(value));

function countStrict() { let hits = 0; for (let round = 0; round < 1000; round++) for (const [left, right] of strictPairs) if (left === right) hits++; return hits; }
function countLoose() { let hits = 0; for (let round = 0; round < 1000; round++) for (const [left, right] of loosePairs) if (left == right) hits++; return hits; }
function countTruthy() { let hits = 0; for (let round = 0; round < 1000; round++) for (const value of truthyValues) { if (value) hits++; if (!!value) hits++; hits += value ? 1 : 0; } return hits; }
function callsDuring(name, run) { const before = count(name); const result = run(); return [result, count(name) - before]; }
console.log("strict", ...callsDuring("operationAOTCompareStrictEq", countStrict));
console.log("loose", ...callsDuring("operationAOTCompareEq", countLoose));
console.log("truthy", ...callsDuring("operationAOTToBoolean", countTruthy));

const [notANumber, zero, negativeZero] = [values[8], values[4], values[5]];
console.log(notANumber === notANumber, notANumber == notANumber, zero === negativeZero, zero == negativeZero);
console.log(BigInt(one) === 1n, BigInt(one) == 1n, BigInt(one) === 2n, 1n == one);
console.log("abcdefghij".repeat(3) === "abcdefghijabcdefghijabcdefghij", rope === "abcdefghij".repeat(4) + "1", rope === "abcdefghij".repeat(4) + "2");
const latin = String.fromCharCode(0xe9) + "x";
const latinFromWide = (String.fromCharCode(0xe9) + "x€").slice(0, 2);
console.log(latin === latinFromWide, latin == latinFromWide, latin !== latinFromWide);

let valueOfCalls = 0;
const counted = { valueOf() { valueOfCalls++; return 1; } };
console.log(counted == one, valueOfCalls);
console.log(one == counted, valueOfCalls);
console.log(counted == "1", valueOfCalls);
console.log("2" == counted, valueOfCalls);
console.log(counted === one, one === counted, valueOfCalls);

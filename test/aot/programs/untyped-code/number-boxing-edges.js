// ==, + and <, array elements and array indexes with operands at the edges of int32: 0, -0, 1, 1.5, 2**31, -(2**31), 2**31 - 1, NaN, Infinity. No operand has a known type. -0, 1.5 and 2**31 are doubles: none may come back as the int32 with the same low bits.
const show = value => (Object.is(value, -0) ? "-0" : String(value));
function check(label, actual, expected) {
  console.log(`${label} = ${show(actual)}: ${Object.is(actual, expected) ? "ok" : `expected ${show(expected)}`}`);
}

function looselyEquals(left, right) { return left == right; }
function lessThan(left, right) { return left < right; }
function add(left, right) { return left + right; }
function subtract(left, right) { return left - right; }
function multiply(left, right) { return left * right; }
function divide(left, right) { return left / right; }
function remainder(left, right) { return left % right; }
function shiftRightUnsigned(left, right) { return left >>> right; }
function negate(value) { return -value; }
function elementAt(list, index) { return list[index]; }
function readValue(holder) { return holder.value; }
function readByKey(holder, key) { return holder[key]; }
const isInt32 = value => Object.is(value, value | 0);

// Each number is paired with its name, so the element type, and the type of every operand below, is unknown.
const operands = [
  ["0", 0],
  ["-0", -0],
  ["1", 1],
  ["1.5", 1.5],
  ["2**31", 2 ** 31],
  ["-(2**31)", -(2 ** 31)],
  ["2**31 - 1", 2 ** 31 - 1],
  ["NaN", NaN],
  ["Infinity", Infinity],
];

// Indexed by the left operand, then by the right operand, in the order of `operands`.
const equal = ["TTFFFFFFF", "TTFFFFFFF", "FFTFFFFFF", "FFFTFFFFF", "FFFFTFFFF", "FFFFFTFFF", "FFFFFFTFF", "FFFFFFFFF", "FFFFFFFFT"];
const less = ["FFTTTFTFT", "FFTTTFTFT", "FFFTTFTFT", "FFFFTFTFT", "FFFFFFFFT", "TTTTTFTFT", "FFFFTFFFT", "FFFFFFFFF", "FFFFFFFFF"];
const sums = [
  [0, 0, 1, 1.5, 2147483648, -2147483648, 2147483647, NaN, Infinity],
  [0, -0, 1, 1.5, 2147483648, -2147483648, 2147483647, NaN, Infinity],
  [1, 1, 2, 2.5, 2147483649, -2147483647, 2147483648, NaN, Infinity],
  [1.5, 1.5, 2.5, 3, 2147483649.5, -2147483646.5, 2147483648.5, NaN, Infinity],
  [2147483648, 2147483648, 2147483649, 2147483649.5, 4294967296, 0, 4294967295, NaN, Infinity],
  [-2147483648, -2147483648, -2147483647, -2147483646.5, 0, -4294967296, -1, NaN, Infinity],
  [2147483647, 2147483647, 2147483648, 2147483648.5, 4294967295, -1, 4294967294, NaN, Infinity],
  [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN],
  [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, NaN, Infinity],
];

const words = ["zero", "one", "two", "three"];
// The same elements, and a property under each key that a wrongly converted index would find.
const labeled = Object.assign(["zero", "one", "two", "three"], {
  "-1": "minus one",
  "1.5": "one and a half",
  "2.5": "two and a half",
  "-2147483648": "the int32 with the bits of 2**31",
  NaN: "not a number",
  Infinity: "infinity",
});

operands.forEach(([leftName, left], leftIndex) => {
  operands.forEach(([rightName, right], rightIndex) => {
    check(`${leftName} == ${rightName}`, looselyEquals(left, right), equal[leftIndex][rightIndex] === "T");
    check(`${leftName} < ${rightName}`, lessThan(left, right), less[leftIndex][rightIndex] === "T");
    check(`${leftName} + ${rightName}`, add(left, right), sums[leftIndex][rightIndex]);

    const pair = [left, right];
    check(`[${leftName}, ${rightName}][0]`, elementAt(pair, 0), left);
    check(`[${leftName}, ${rightName}][1]`, elementAt(pair, 1), right);

    // A number and its string are the same property key.
    const key = String(sums[leftIndex][rightIndex]);
    check(`words[${leftName} + ${rightName}]`, elementAt(words, add(left, right)), words[key]);
    check(`labeled[${leftName} + ${rightName}]`, elementAt(labeled, add(left, right)), labeled[key]);
  });
});

for (const [name, value] of operands) {
  check(`{ value: ${name} }.value`, readValue({ value }), value);
  const holder = { name, value };
  check(`{ name, value: ${name} }.value`, readValue(holder), value);
  for (const key of Object.keys(holder)) check(`{ name, value: ${name} }["${key}"]`, readByKey(holder, key), key === "name" ? name : value);
  check(`["text", ${name}][1]`, elementAt(["text", value], 1), value);
  check(`[0.5, ${name}][1]`, elementAt([0.5, value], 1), value);
}

function checkResults(resultIsInt32, cases) {
  for (const [label, operation, left, right, expected] of cases) {
    const actual = operation(left, right);
    check(label, actual, expected);
    check(`${label} is an int32`, isInt32(actual), resultIsInt32);
  }
}

// Int32 operands, and a result that is not an int32.
checkResults(false, [
  ["-1 * 0", multiply, -1, 0, -0],
  ["0 * -1", multiply, 0, -1, -0],
  ["0 / -1", divide, 0, -1, -0],
  ["-1 % 1", remainder, -1, 1, -0],
  ["-(2**31) % -1", remainder, -(2 ** 31), -1, -0],
  ["-(0)", negate, 0, undefined, -0],
  ["3 / 2", divide, 3, 2, 1.5],
  ["(2**31 - 1) + 1", add, 2 ** 31 - 1, 1, 2 ** 31],
  ["0 - -(2**31)", subtract, 0, -(2 ** 31), 2 ** 31],
  ["65536 * 32768", multiply, 65536, 32768, 2 ** 31],
  ["-(2**31) / -1", divide, -(2 ** 31), -1, 2 ** 31],
  ["-(2**31) >>> 0", shiftRightUnsigned, -(2 ** 31), 0, 2 ** 31],
  ["-(-(2**31))", negate, -(2 ** 31), undefined, 2 ** 31],
]);

// A double operand, and a result that is an int32.
checkResults(true, [
  ["1.5 + 1.5", add, 1.5, 1.5, 3],
  ["2**31 - 1", subtract, 2 ** 31, 1, 2 ** 31 - 1],
  ["2**31 + -(2**31)", add, 2 ** 31, -(2 ** 31), 0],
  ["-0 + 0", add, -0, 0, 0],
  ["0.5 * 4", multiply, 0.5, 4, 2],
]);

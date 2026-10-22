const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;

function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }
function mul(a, b) { return a * b; }
function div(a, b) { return a / b; }
function mod(a, b) { return a % b; }
function bitAnd(a, b) { return a & b; }
function bitOr(a, b) { return a | b; }
function bitXor(a, b) { return a ^ b; }
function leftShift(a, b) { return a << b; }
function rightShift(a, b) { return a >> b; }
function unsignedRightShift(a, b) { return a >>> b; }
function less(a, b) { return a < b; }
function lessEq(a, b) { return a <= b; }
function greater(a, b) { return a > b; }
function greaterEq(a, b) { return a >= b; }

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  return Object.is(value, -0) ? "-0" : String(value);
}

function attempt(operator, left, right) {
  try {
    return show(operator(left, right));
  } catch (error) {
    return error.name;
  }
}

const makeOperands = [
  () => 0, () => -0, () => 1, () => -1, () => 2 ** 31 - 1, () => -(2 ** 31), () => 2 ** 32, () => 1.5, () => NaN, () => Infinity,
  () => true, () => false, () => null, () => undefined,
  () => "", () => "a", () => "b", () => "ab", () => "10", () => "ā",
  () => add("left half of ", "a rope string"),
  () => 1n, () => ({}), () => [], () => ({ valueOf() { return 2; } }),
];

const isInt32 = value => Object.is(value | 0, value);
const bothInt32 = (a, b) => isInt32(a) && isInt32(b);
const always = () => true;
const staysInt32 = operator => (a, b) => !bothInt32(a, b) || isInt32(operator(a, b));
const hasNonzeroInt32Product = (a, b) => !bothInt32(a, b) || (isInt32(a * b) && a * b !== 0);
const hasPositiveOperands = (a, b) => bothInt32(a, b) && a >= 0 && b > 0;
const fitsInt32 = (a, b) => a >>> b <= 2 ** 31 - 1;

const numbers = [0, -0, 1, -1, 2 ** 31 - 1, -(2 ** 31), 2 ** 32, 1.5, NaN, Infinity];
const truncatedOperands = [0, -0, 1, -1, 2 ** 31 - 1, -(2 ** 31), 2 ** 32, 1.5, true, false, null, undefined];
const nonemptyStrings = ["a", "b", "ab", "10"];
const flatStrings = ["", ...nonemptyStrings];

const operators = [
  ["add", add, "operationAOTValueAdd", numbers, staysInt32(add)],
  ["sub", sub, "operationAOTValueSub", numbers, staysInt32(sub)],
  ["mul", mul, "operationAOTValueMul", numbers, hasNonzeroInt32Product],
  ["div", div, "operationAOTValueDiv", numbers, always],
  ["mod", mod, "operationAOTValueMod", numbers, hasPositiveOperands],
  ["bitAnd", bitAnd, "operationAOTValueBitAnd", truncatedOperands, always],
  ["bitOr", bitOr, "operationAOTValueBitOr", truncatedOperands, always],
  ["bitXor", bitXor, "operationAOTValueBitXor", truncatedOperands, always],
  ["leftShift", leftShift, "operationAOTValueLShift", truncatedOperands, always],
  ["rightShift", rightShift, "operationAOTValueRShift", truncatedOperands, always],
  ["unsignedRightShift", unsignedRightShift, "operationAOTValueURShift", truncatedOperands, fitsInt32],
  ["less", less, "operationAOTCompareLess", numbers, always],
  ["lessEq", lessEq, "operationAOTCompareLessEq", numbers, always],
  ["greater", greater, "operationAOTCompareGreater", numbers, always],
  ["greaterEq", greaterEq, "operationAOTCompareGreaterEq", numbers, always],
];

for (const [name, operator] of operators) {
  makeOperands.forEach((makeLeft, index) => {
    const results = makeOperands.map(makeRight => attempt(operator, makeLeft(), makeRight()));
    console.log(name, index, results.join(" "));
  });
}

function pairsOf(lefts, rights, isIncluded) {
  const pairs = [];
  for (const left of lefts) {
    for (const right of rights) {
      if (isIncluded(left, right)) pairs.push([left, right]);
    }
  }
  return pairs;
}

const rounds = 1000;

function countRowCalls(operator, row, pairs) {
  const before = count(row);
  for (let round = 0; round < rounds; round++) {
    for (const [left, right] of pairs) operator(left, right);
  }
  return count(row) - before;
}

for (const [name, operator, row, operands, isIncluded] of operators) {
  console.log(name, "row calls on primitives", countRowCalls(operator, row, pairsOf(operands, operands, isIncluded)));
}

for (const [name, operator, row] of operators.slice(-4)) {
  console.log(name, "row calls on flat strings", countRowCalls(operator, row, pairsOf(flatStrings, flatStrings, always)));
}

console.log("add row calls with an empty string", countRowCalls(add, "operationAOTValueAdd", [["", "a"], ["a", ""], ["", ""]]));
const ropePairs = pairsOf(nonemptyStrings, nonemptyStrings, always);
const ropeRowCalls = countRowCalls(add, "operationAOTValueAdd", ropePairs);
console.log("add enters the row only to refill allocation", ropeRowCalls * 64 <= rounds * ropePairs.length);

console.log(show(add(2 ** 31 - 1, 1)));
console.log(show(sub(-(2 ** 31), 1)));
console.log(show(mul(65536, 65536)));
console.log(show(mul(0, -1)));
console.log(show(unsignedRightShift(-1, 0)));
console.log(show(mod(-1, 2)));
console.log(show(mod(1, 0)));
console.log(show(mod(5, -2)));
console.log(show(less("a", "ab")));
console.log(show(less("b", "ab")));
console.log(show(less("a", "ā")));
console.log(attempt(add, 1n, 1));

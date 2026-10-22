// & | ^ << >> >>> from untyped code on doubles outside int32: ToInt32 wraps modulo 2 ** 32. A double within int64 is converted without a call of the engine.
// Only the jsc shell can count. Elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;

function bitAnd(a, b) { return a & b; }
function bitOr(a, b) { return a | b; }
function bitXor(a, b) { return a ^ b; }
function leftShift(a, b) { return a << b; }
function rightShift(a, b) { return a >> b; }
function unsignedRightShift(a, b) { return a >>> b; }

const withinInt64 = [
  2 ** 31, -(2 ** 31) - 1, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 5, -(2 ** 32) - 5, 2 ** 33 + 2 ** 31, 4294967296.75, -4294967296.75,
  2 ** 53 - 1, -(2 ** 53) + 1, 1e18, -1e18, 2 ** 62, -(2 ** 62), 2 ** 63 - 1024, -(2 ** 63) + 1024,
];
const outsideInt64 = [2 ** 63, -(2 ** 63), 2 ** 63 + 2048, 2 ** 64, 2 ** 64 + 2 ** 33, -(2 ** 64) - 2 ** 33, 2 ** 84 + 2 ** 32, 1e300, -1e300, Infinity, -Infinity, NaN];
const smallOperands = [0, 1, -1, 31, 32, 33, 1.5, 2 ** 31 - 1, -(2 ** 31)];
// These keep the operand types of the six functions unknown.
const otherOperands = ["7", "4294967301", null, undefined, true, { valueOf() { return 2 ** 32 + 9; } }];

const always = () => true;
const fitsInt32 = (a, b) => a >>> b <= 2 ** 31 - 1;
const operators = [
  ["bitAnd", bitAnd, "operationAOTValueBitAnd", always],
  ["bitOr", bitOr, "operationAOTValueBitOr", always],
  ["bitXor", bitXor, "operationAOTValueBitXor", always],
  ["leftShift", leftShift, "operationAOTValueLShift", always],
  ["rightShift", rightShift, "operationAOTValueRShift", always],
  ["unsignedRightShift", unsignedRightShift, "operationAOTValueURShift", fitsInt32],
];

const large = [...withinInt64, ...outsideInt64];
const all = [...large, ...smallOperands, ...otherOperands];
for (const [name, operator] of operators) {
  large.forEach((operand, index) => {
    console.log(name, index, "left", all.map(other => operator(operand, other)).join(" "));
    console.log(name, index, "right", all.map(other => operator(other, operand)).join(" "));
  });
}

const counted = [...withinInt64, ...smallOperands];
for (const [name, operator, row, isIncluded] of operators) {
  const pairs = [];
  for (const left of counted) {
    for (const right of counted) {
      if (isIncluded(left, right)) pairs.push([left, right]);
    }
  }
  const before = count(row);
  for (let round = 0; round < 100; round++) {
    for (const [left, right] of pairs) operator(left, right);
  }
  console.log(name, "row calls within int64", count(row) - before);
}

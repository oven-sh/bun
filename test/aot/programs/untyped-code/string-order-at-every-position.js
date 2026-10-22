// < <= > >= from untyped code on 8-bit strings of up to 20 characters: the first difference at every position, characters above 0x7f, one string a prefix of the other.
// Only the jsc shell can count. Elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;

function less(a, b) { return a < b; }
function lessEq(a, b) { return a <= b; }
function greater(a, b) { return a > b; }
function greaterEq(a, b) { return a >= b; }

const operators = [
  [less, "operationAOTCompareLess"],
  [lessEq, "operationAOTCompareLessEq"],
  [greater, "operationAOTCompareGreater"],
  [greaterEq, "operationAOTCompareGreaterEq"],
];

// One hexadecimal digit: bit i is the answer of operator i.
function order(left, right) {
  let bits = 0;
  operators.forEach(([operator], index) => {
    if (operator(left, right)) bits |= 1 << index;
  });
  return bits.toString(16);
}

// Reading a character flattens a rope.
function flat(string) {
  if (string.length) string.charCodeAt(0);
  return string;
}

const alphabet = "mnopqrstuvwxyzmnopqr";
const replacements = ["\x01", "a", "z", "\x7f", "\x80", "\xe9", "\xff"];
for (let length = 0; length <= alphabet.length; length++) {
  const base = flat(alphabet.slice(0, length));
  const row = [order(base, flat(alphabet.slice(0, length)))];
  if (length) row.push(order(base, flat(alphabet.slice(0, length - 1))), order(flat(alphabet.slice(0, length - 1)), base));
  for (let position = 0; position < length; position++) {
    for (const replacement of replacements) {
      const changed = flat(base.slice(0, position) + replacement + base.slice(position + 1));
      const changedAndLonger = flat(changed + "m");
      row.push(order(base, changed) + order(changed, base) + order(base, changedAndLonger) + order(changedAndLonger, base));
    }
  }
  console.log(length, row.join(" "));
}

for (const first of replacements) console.log(JSON.stringify(first), replacements.map(second => order(flat("mnopqrst" + first), flat("mnopqrst" + second))).join(" "));

// These keep the operand types of the four functions unknown.
const others = [1, "10", "9", null, undefined, true, "ā", "mnopā", { toString() { return "mnop"; } }, 2n];
for (const left of others) console.log(others.map(right => order(left, right)).join(" "), order(left, "mnop"), order("mnop", left));

const literals = [
  "", "m", "mno", "mnop", "mnoq", "mnopq", "mnopqrs", "mnopqrst", "mnopqrsu", "anopqrst", "mnopqrstu", "mnopqrstuvw", "mnopqrstuvwx", "mnopqrstuvwy", "mnopqrstuvwxyzm", "mnopqrstuvwxyzmn",
  "mnopqrstuvwxyzmo", "mnopqrsuuvwxyzmn", "mnopqrstuvwxyzmno", "mnopqrstuvwxyzmnopqr", "mnopqrstuvwxyzmnopqs",
];
console.log(literals.map(left => literals.map(right => order(left, right)).join("")).join(" "));
for (const [operator, row] of operators) {
  const before = count(row);
  for (let round = 0; round < 100; round++) {
    for (const left of literals) {
      for (const right of literals) operator(left, right);
    }
  }
  console.log(operator.name, "row calls on flat strings", count(row) - before);
}

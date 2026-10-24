// -0 has the literal type 0: it enters every location whose type lists 0, and it stays -0 there.
type Digit = 0 | 1 | 2;
type Sign = -1 | 0 | 1;
interface Cell { digit: Digit; sign: Sign; zero: 0 }
class Counter {
  digit: Digit = 0;
  set(value: Digit): Digit { this.digit = value; return this.digit }
}

const describe = (value: number) => (Object.is(value, -0) ? "-0" : String(value)) + " (" + 1 / value + ")";
function pass(value: Digit): Digit { return value }
function roundToDigit(value: number): Digit { return Math.round(value) as Digit }
function signOf(value: number): Sign { return Math.sign(value) as Sign }
function negate(value: 0): 0 { return -value as 0 }
function fromAnywhere(value: unknown): Digit { return value as Digit }

const inputs = [-0.4, -0, 0, 0.4, 1.2, 1.6];
const cell: Cell = { digit: 0, sign: 0, zero: 0 };
const counter = new Counter();
const digits: Digit[] = [];
const byName = new Map<string, Digit>();

let minusZeros = 0;
for (let round = 0; round < 3_000; round++) {
  const input = inputs[round % inputs.length];
  cell.digit = roundToDigit(input);
  cell.sign = signOf(input);
  cell.zero = negate(cell.zero);
  digits[round % 8] = pass(cell.digit);
  byName.set("digit", counter.set(digits[round % 8]));
  for (const value of [cell.digit, cell.sign, cell.zero, digits[round % 8], counter.digit, byName.get("digit")!, fromAnywhere(cell.digit)])
    if (Object.is(value, -0)) minusZeros++;
}
console.log("minus zeros:", minusZeros);

for (const input of inputs) {
  cell.digit = roundToDigit(input);
  cell.sign = signOf(input);
  console.log(input, "|", describe(roundToDigit(input)), "|", describe(signOf(input)), "|", describe(pass(cell.digit)), "|", describe(cell.sign), "|", describe(counter.set(cell.digit)), "|", describe(fromAnywhere(input === 0 ? input : 1)));
}
console.log(describe(negate(0)), describe(negate(negate(0))), JSON.stringify(cell), [cell.digit === 0, cell.sign === 0].join());
switch (roundToDigit(-0.2)) {
  case 0: console.log("case 0"); break;
  default: console.log("default");
}

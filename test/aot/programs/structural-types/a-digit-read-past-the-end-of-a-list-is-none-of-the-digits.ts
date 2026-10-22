type Digit = 0 | 1;
const digits: Digit[] = [0, 1];

function text(digit: Digit): string {
  if (digit === 0) return "zero";
  if (digit === 1) return "one";
  return "neither, undefined: " + (digit === undefined);
}
function other(digit: Digit): string {
  if (digit === 0) return "zero";
  return "one: " + (digit === 1);
}

console.log(text(digits[0]), text(digits[1]));
console.log(other(digits[2]));
console.log(text(digits[2]));

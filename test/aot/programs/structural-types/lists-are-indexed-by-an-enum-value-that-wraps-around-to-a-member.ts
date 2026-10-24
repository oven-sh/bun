enum Op {
  A,
  B,
  C,
  D,
}
const table = ["a", "b", "c", "d"];
const sizes = [1.5, 2.5, 3.5, 4.5];
const whole = [10, 20, 30, 40];
function read(op: Op): string {
  return table[op] + " " + sizes[op] + " " + whole[op];
}
const numbers: number[] = [0, 3, 4, -1, -0, 0.5, NaN, 2 ** 32, 2 ** 32 + 1, 2 ** 31, -(2 ** 32) + 1, 1e21];
for (const n of numbers) console.log(n, read(n));
const wrapped: number = 2 ** 32 + 2;
console.log(read(wrapped));

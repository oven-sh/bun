// A truncated number is a new value: the fraction and the sign of zero stay with the original.
declare const console: { log(...values: unknown[]): void };
function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function f(x: number): number[] {
  const i = Math.trunc(x);
  return [i, i + 0.5, x, 1 / i];
}
function int32Forms(x: number): number[] {
  return [x | 0, x >>> 0, ~~x];
}
function line(values: number[]): string {
  return values.map(show).join(" ");
}
const inputs = [1.5, -0.5, -0, NaN, 2 ** 40 + 0.5, 2 ** 62, Infinity];
for (const x of inputs) console.log("once", show(x), line(f(x)), line(int32Forms(x)));
for (const x of inputs) {
  let truncated: number[] = [];
  let forms: number[] = [];
  for (let n = 0; n < 20000; n++) {
    truncated = f(x);
    forms = int32Forms(x);
  }
  console.log("hot", show(x), line(truncated), line(forms));
}
for (const x of [0, 1, 7, 2147483647, 2 ** 40]) {
  const i = Math.trunc(x);
  console.log("integral", x, i === x, f(x)[2] === x, (x | 0) === x, (x >>> 0) === x, ~~x === x);
}
for (const x of [-1, -2147483648]) console.log("negative integral", x, Math.trunc(x) === x, (x | 0) === x, ~~x === x);

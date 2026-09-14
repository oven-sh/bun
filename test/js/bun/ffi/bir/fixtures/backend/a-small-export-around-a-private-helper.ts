import * as c from "./a-small-export-around-a-private-helper.c";

// A hundred and fifty thousand calls each, four times over: far past the thresholds of every tier.
const rounds = 150_000;
function mix(x: number, count: number) {
  x >>>= 0;
  for (let i = 1; i <= count; i++) {
    x = (Math.imul(x, 3) + i) >>> 0;
    x = (x ^ (x >>> 7)) >>> 0;
    x = (x + (x << 3)) >>> 0;
  }
  return x;
}
const cases: [string, (x: number) => number, (x: number) => number][] = [
  ["around_1", c.around_1, (x) => (mix(x, 1) + 1) >>> 0],
  ["around_20", c.around_20, (x) => (mix(x, 20) + 1) >>> 0],
  ["around_23", c.around_23, (x) => (mix(x, 23) + 1) >>> 0],
  ["around_30", c.around_30, (x) => (mix(x, 30) + 1) >>> 0],
  ["around_80", c.around_80, (x) => (mix(x, 80) + 1) >>> 0],
  ["around_220", c.around_220, (x) => (mix(x, 220) + 1) >>> 0],
  ["two_levels", c.two_levels, (x) => (mix(x, 60) + 2) >>> 0],
  ["first_of_two", c.first_of_two, (x) => (mix(x, 40) + 1) >>> 0],
  ["second_of_two", c.second_of_two, (x) => (mix(x, 40) + 2) >>> 0],
  ["around_forced", c.around_forced, (x) => (mix(x, 40) + 1) >>> 0],
  ["around_kept_out", c.around_kept_out, (x) => (mix(x, 40) + 1) >>> 0],
  ["around_addressed", c.around_addressed, (x) => (mix(x, 40) + 1) >>> 0],
];
const lines: string[] = [];
for (const [name, compiled, reference] of cases) {
  // A loop of its own source for each function, so each call site only ever sees one callee.
  const run = new Function(
    "f",
    `return function run_${name}(n) { let t = 0; for (let i = 0; i < n; i++) t = (t ^ f(i)) >>> 0; return t; }`,
  )(compiled);
  let expected = 0;
  for (let i = 0; i < rounds; i++) expected = (expected ^ reference(i)) >>> 0;
  let wrong = compiled(5) === reference(5) ? 0 : 1;
  for (let round = 0; round < 4; round++) if (run(rounds) !== expected) wrong++;
  lines.push(`${name} ${wrong} ${expected}`);
}
console.log(lines.join("\n"));

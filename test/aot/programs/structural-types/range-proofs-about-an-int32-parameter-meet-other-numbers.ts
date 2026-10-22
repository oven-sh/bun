import type { int32 } from "bun";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

function upOnce(i: int32): int32 {
  return i < 100 ? i + 1 : i;
}
function downOnce(i: int32): int32 {
  return i > -100 ? i - 1 : i;
}
function upTwice(i: int32): int32 {
  if (i < 100) {
    i++;
    i++;
  }
  return i;
}
function notAtLeast(i: int32): int32 {
  if (!(i >= 100)) i++;
  return i;
}
function until(i: int32): int32 {
  do {
    if (i >= 100) break;
    i++;
  } while (true);
  return i;
}
function product(i: int32, j: int32): int32 {
  return i < 100 && j < 100 && i > 0 && j > 0 ? i * j : 0;
}
function negative(i: int32): int32 {
  return i > 0 ? -i : 0;
}
function remainder(i: int32): int32 {
  return i >= 0 ? i % 7 : 0;
}
function remainderOf(i: int32, j: int32): int32 {
  return i >= 0 && j > 0 ? i % j : 0;
}
function quotient(i: int32): int32 {
  return i > 0 ? Math.floor(7 / i) : 0;
}
function counted(from: int32, to: int32): int32 {
  let turns: int32 = 0;
  for (let i: int32 = from; i < to; i++) turns = (turns + 1) | 0;
  return turns;
}
function least(a: int32, b: int32): int32 {
  return Math.min(a, b);
}
function sign(a: int32): int32 {
  return Math.sign(a);
}
function half(a: int32): int32 {
  return Math.floor(a / 2);
}
function times(a: int32): int32 {
  return a * 1;
}
function and(a: int32): int32 {
  return a && 1;
}

const one: [string, (i: number) => number][] = [
  ["up once", upOnce],
  ["down once", downOnce],
  ["up twice", upTwice],
  ["not at least", notAtLeast],
  ["negative", negative],
  ["remainder", remainder],
  ["quotient", quotient],
  ["sign", sign],
  ["half", half],
  ["times one", times],
  ["and", and],
];
const two: [string, (i: number, j: number) => number][] = [
  ["product", product],
  ["remainder of", remainderOf],
  ["counted", counted],
  ["least", least],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const v = (i % 150) | 0;
  warm += upOnce(v) + downOnce(v) + upTwice(v) + notAtLeast(v) + until(v) + product(v, 3) + negative(v) + remainder(v) + remainderOf(v, 5) + quotient(v) + counted(0, v) + least(v, 7) + sign(v) + half(v) + times(v) + and(v);
}
console.log("2000 honest rounds", warm);

const odd: number[] = [1.5, 99.5, -0, -0.5, 0.25, NaN, 2 ** 31, -(2 ** 31) - 1, 1e21, Infinity, -Infinity, 7.5];
for (const n of odd) {
  attempt(show(n), () => one.map(([, run]) => run(n)));
  const some = Math.abs(n) < 1000 || n !== n ? two : two.filter(([label]) => label !== "counted");
  attempt(show(n) + " and 3", () => some.map(([, run]) => run(n, 3)));
  attempt("2 and " + show(n), () => some.map(([, run]) => run(2, n)));
}
attempt("until, from a fraction", () => {
  const run: (i: number) => number = until;
  return [run(98.5), run(99.5), run(-0), run(2 ** 31), run(Infinity)];
});
attempt("labels", () => [...one, ...two].map(([label]) => label));

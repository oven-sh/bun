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

class Cell {
  held: int32 = 0;
  next: int32 = 7;
}

function uses(v: int32): unknown[] {
  const cell = new Cell();
  cell.held = v;
  const pair: int32[] = [v, 1];
  return [typeof v, v, v + 1, v - 1, v * 2, v / 2, v % 2, -v, 1 / v, v | 0, v >>> 0, v >> 1, v << 1, ~v, v & 3, v === v, v === 0, v < 1, v >= 1, !v, String(v), cell.held, cell.next, pair[0], cell.held + pair[0], Math.abs(v), Math.floor(v), [10, 20, 30][v]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(i | 0).length + uses(-i | 0).length;
console.log("4000 honest uses", warm);

const odd: number[] = JSON.parse("[1.5, -0, 2147483648, -2147483649, 1e21, 3]");
odd.push(NaN, Infinity);

const seen: unknown[][] = [];
function note(v: int32): int32 {
  seen.push(uses(v));
  return v;
}
function plus(sum: int32, v: int32): int32 {
  return (sum + v) | 0;
}
function plainPlus(sum: int32, v: int32): number {
  return sum + v;
}
function order(a: int32, b: int32): int32 {
  return a < b ? -1 : a > b ? 1 : 0;
}
function small(v: int32): boolean {
  return v < 2;
}
function drain(): unknown[][] {
  return seen.splice(0);
}

const few: number[] = [1.5, -0, 2 ** 31];
attempt("map", () => [few.map(note), drain()]);
attempt("forEach", () => [few.forEach(note), drain()]);
attempt("reduce", () => [few.reduce(plus, 0), few.reduce(plainPlus, 0), few.reduce(plainPlus)]);
attempt("reduceRight", () => few.reduceRight(plainPlus, 0));
attempt("sort", () => [2.5, 2.25, -0, 0, NaN, 2 ** 31].sort(order));
attempt("toSorted", () => [2.5, 2.25, 2 ** 32, 1e21].toSorted(order));
attempt("filter, find, some, every", () => [few.filter(small), few.find(small), few.findIndex(small), few.findLast(small), few.some(small), few.every(small)]);
attempt("Array.from", () => [Array.from(few, note), drain()]);
attempt("a float array", () => [Array.from(new Float64Array(few).map(note)), drain()]);
attempt("the values of a map", () => {
  new Map([["a", 0.25]]).forEach(note);
  return drain();
});
attempt("the values of a set", () => {
  new Set([0.75]).forEach(note);
  return drain();
});
attempt("flatMap", () => [few.flatMap(note), drain()]);
await Promise.resolve(3.5).then(note);
attempt("a promise", () => drain());
await new Promise<void>(resolve => {
  setTimeout(
    (v: int32) => {
      note(v);
      resolve();
    },
    0,
    4.5,
  );
});
attempt("a timer", () => drain());
attempt("honest again", () => [[1, 2].map(note), drain()]);

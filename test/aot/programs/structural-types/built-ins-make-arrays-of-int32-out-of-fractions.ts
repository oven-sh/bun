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

function head(list: int32[]): int32 {
  return list[0];
}

const makers: [string, () => int32[]][] = [
  ["map", () => [3, 5].map(v => v / 2)],
  ["Array.from with a function", () => Array.from({ length: 2 }, (_, i) => (i + 1) / 2)],
  ["Array.from a float array", () => Array.from(new Float64Array([1.5, 2.5]))],
  ["a float array is spread", () => [...new Float64Array([-0, 2.5])]],
  ["Array.of", () => Array.of(2 ** 31, 1)],
  ["flatMap", () => [1].flatMap(v => [v / 4, v])],
  ["Object.values", () => Object.values({ a: NaN, b: 1 })],
  ["the values of a map", () => [...new Map([["a", 1e21]]).values()]],
  ["a set is spread", () => [...new Set([0.25])]],
  ["filter", () => [0.75, 1].filter(v => v < 1)],
  ["slice", () => [2.5, 1].slice(0, 1)],
  ["toSorted", () => [3, 0.125].toSorted((a, b) => a - b)],
  ["a clone", () => structuredClone([Infinity])],
  ["parsed", () => JSON.parse("[6.5]")],
  ["split and converted", () => "7.5,8".split(",").map(Number)],
  ["Array.from a length alone", () => Array.from<int32>({ length: 2 })],
];

for (const [label, make] of makers) {
  attempt(label, () => {
    const list = make();
    const v: int32 = head(list);
    return [list, uses(v)];
  });
}

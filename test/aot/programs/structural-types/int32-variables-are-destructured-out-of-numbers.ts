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

interface Point {
  x: int32;
  y?: int32;
}
function fromParameter({ x, y = 9 }: Point): unknown[] {
  return [uses(x), uses(y)];
}
function fromList([a, b = 9]: int32[]): unknown[] {
  return [uses(a), uses(b)];
}

let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += fromParameter({ x: i | 0 }).length + fromList([i | 0]).length;
console.log("2000 honest rounds", rounds);

for (const n of odd) {
  const label = show(n);
  const wide = { x: n, y: n };
  const list: number[] = [n, n];
  attempt(label + " out of a list", () => {
    const [v]: int32[] = list;
    return uses(v);
  });
  attempt(label + " out of an object", () => {
    const { x }: Point = wide;
    return uses(x);
  });
  attempt(label + " with a default", () => {
    const { y = 0 }: Point = wide;
    return uses(y);
  });
  attempt(label + " the rest of a list", () => {
    const [, ...rest]: int32[] = list;
    const v: int32 = rest[0];
    return uses(v);
  });
  attempt(label + " a parameter that is an object", () => fromParameter(wide));
  attempt(label + " a parameter that is a list", () => fromList(list));
  attempt(label + " in a loop", () => {
    const points: Point[] = [wide];
    for (const { x } of points) return uses(x);
    return "none";
  });
}
attempt("nothing there", () => {
  const [v]: int32[] = [];
  return uses(v);
});

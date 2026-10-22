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

function same<T>(value: T): T {
  return value;
}
function first<T>(list: T[]): T {
  return list[0];
}
function pick<T, K extends keyof T>(from: T, key: K): T[K] {
  return from[key];
}
class Box<T> {
  constructor(public held: T) {}
  get(): T {
    return this.held;
  }
  put(value: T): void {
    this.held = value;
  }
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " identity", () => {
    const v: int32 = same<int32>(n);
    return uses(v);
  });
  attempt(label + " first of a list", () => {
    const v: int32 = first<int32>([n]);
    return uses(v);
  });
  attempt(label + " picked by a key", () => {
    const v: int32 = pick<{ at: int32 }, "at">({ at: same<int32>(n) }, "at");
    return uses(v);
  });
  attempt(label + " constructed into a box", () => {
    const v: int32 = new Box<int32>(n).get();
    return uses(v);
  });
  attempt(label + " put into a box", () => {
    const box = new Box<int32>(0);
    box.put(n);
    const v: int32 = box.held;
    return uses(v);
  });
  attempt(label + " a box of numbers under another name", () => {
    const box: Box<int32> = new Box<number>(n);
    const v: int32 = box.get();
    return uses(v);
  });
}
attempt("first of an empty list", () => {
  const v: int32 = first<int32>([]);
  return uses(v);
});
attempt("honest again", () => uses(same<int32>(5)));

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

class Cursor {
  static made: int32 = 0;
  line: int32 = 0;
  column: int32 = 0;
  constructor(line: int32, column: int32) {
    this.line = line;
    this.column = column;
    Cursor.made = (Cursor.made + 1) | 0;
  }
  move(by: int32): this {
    this.column = (this.column + by) | 0;
    return this;
  }
  distance(other: Cursor): int32 {
    return (Math.imul(this.line - other.line, 80) + (this.column - other.column)) | 0;
  }
}

function sum(list: int32[]): int32 {
  let total: int32 = 0;
  for (let i = 0; i < list.length; i++) total = (total + list[i]) | 0;
  return total;
}
function count(to: int32): int32 {
  let turns: int32 = 0;
  for (let i: int32 = 0; i < to; i++) turns = (turns + 1) | 0;
  return turns;
}
function mix(a: int32, b: int32): int32 {
  return (Math.imul(a, 31) ^ (b >>> 3) ^ (a << 7)) | 0;
}

const limits: int32[] = [0, 1, -1, 2147483647, -2147483648, 65536, -65536];
for (const v of limits) attempt(show(v), () => uses(v));
attempt("sum", () => sum(limits));
attempt("count", () => [count(0), count(10), count(-5)]);
attempt("mixed", () => {
  let hash: int32 = 17;
  for (let i = 0; i < 2000; i++) hash = mix(hash, i | 0);
  return hash;
});
attempt("cursors", () => {
  const a = new Cursor(1, 2147483647).move(1);
  const b = new Cursor(-2147483648, 0).move(-1);
  return [a.line, a.column, b.line, b.column, a.distance(b), Cursor.made, JSON.stringify([a, b])];
});
attempt("a closure", () => {
  let kept: int32 = 0;
  const add = (v: int32): void => {
    kept = (kept + v) | 0;
  };
  for (const v of limits) add(v);
  return kept;
});

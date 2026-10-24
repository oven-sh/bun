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
}
class Cursor {
  line: int32 = 0;
  column: int32 = 0;
  lineOf(): int32 {
    return this.line;
  }
  both(): int32 {
    return (this.line + this.column) | 0;
  }
}
class Meter {
  #level: int32 = 0;
  get level(): int32 {
    return this.#level;
  }
  set level(value: int32) {
    this.#level = value;
  }
}

function xOf(point: Point): int32 {
  return point.x;
}
function setX(target: { x: number }, value: number): void {
  target.x = value;
}
function setLine(target: { line: number }, value: number): void {
  target.line = value;
}
function setLevel(target: { level: number }, value: number): void {
  target.level = value;
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " into a literal", () => {
    const point: Point = { x: 1 };
    setX(point, n);
    return uses(xOf(point));
  });
  attempt(label + " into an instance", () => {
    const cursor = new Cursor();
    cursor.column = 2;
    setLine(cursor, n);
    return [uses(cursor.lineOf()), cursor.column, cursor.both(), JSON.stringify(cursor)];
  });
  attempt(label + " into a setter", () => {
    const meter = new Meter();
    setLevel(meter, n);
    return uses(meter.level);
  });
}
attempt("after 2000 honest stores", () => {
  const cursor = new Cursor();
  for (let i = 0; i < 2000; i++) setLine(cursor, i);
  setLine(cursor, odd[0]);
  return uses(cursor.lineOf());
});

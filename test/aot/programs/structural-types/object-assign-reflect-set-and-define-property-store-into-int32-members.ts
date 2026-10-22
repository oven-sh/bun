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
  static total: int32 = 0;
  line: int32 = 0;
  column: int32 = 4;
  lineOf(): int32 {
    return this.line;
  }
  static totalOf(): int32 {
    return Cursor.total;
  }
}
interface Point {
  x: int32;
  y: int32;
}
function xOf(point: Point): int32 {
  return point.x;
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " Object.assign onto an instance", () => {
    const cursor = new Cursor();
    Object.assign(cursor, { line: n });
    return [uses(cursor.lineOf()), cursor.column];
  });
  attempt(label + " Object.assign onto a literal", () => {
    const point: Point = { x: 1, y: 2 };
    Object.assign(point, { x: n });
    return [uses(xOf(point)), point.y];
  });
  attempt(label + " the result of Object.assign", () => {
    // The target is written as a Point. A literal whose `x` is a number would be refused by the build: type-rules/an-object-with-a-number-member-is-taken-for-a-type-with-an-int32-member.ts
    const point: Point = Object.assign<Point, object>({ x: 1, y: 2 }, { x: n });
    return [uses(xOf(point)), point.y];
  });
  attempt(label + " Reflect.set", () => {
    const cursor = new Cursor();
    const done = Reflect.set(cursor, "line", n);
    return [done, uses(cursor.lineOf()), cursor.column];
  });
  attempt(label + " defineProperty with a value", () => {
    const cursor = new Cursor();
    Object.defineProperty(cursor, "line", { value: n, writable: true, enumerable: true, configurable: true });
    return [uses(cursor.lineOf()), cursor.column];
  });
  attempt(label + " defineProperty with a getter", () => {
    const cursor = new Cursor();
    Object.defineProperty(cursor, "line", { get: () => n, enumerable: true, configurable: true });
    return [uses(cursor.lineOf()), cursor.column, JSON.stringify(cursor)];
  });
  attempt(label + " a static member", () => {
    Object.assign(Cursor, { total: n });
    return uses(Cursor.totalOf());
  });
}
attempt("a text by Reflect.set", () => {
  const cursor = new Cursor();
  Reflect.set(cursor, "line", "12");
  return uses(cursor.lineOf());
});
attempt("deleted by Reflect.deleteProperty", () => {
  const cursor = new Cursor();
  Reflect.deleteProperty(cursor, "line");
  return [uses(cursor.lineOf()), cursor.column, Object.keys(cursor)];
});

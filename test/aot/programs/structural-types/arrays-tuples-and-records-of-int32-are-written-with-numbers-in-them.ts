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

interface Row {
  cells: int32[];
  ends: [int32, int32];
  named: Record<string, int32>;
}

function firstCell(row: Row): int32 {
  return row.cells[0];
}
function width(row: Row): int32 {
  return (row.ends[1] - row.ends[0]) | 0;
}
function plainWidth(row: Row): number {
  return row.ends[1] - row.ends[0];
}
function named(row: Row, name: string): int32 {
  return row.named[name];
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " in an array", () => {
    const list: int32[] = [n];
    const v: int32 = list[0];
    return uses(v);
  });
  attempt(label + " in a tuple", () => {
    const pair: [int32, int32] = [n, 1];
    const v: int32 = pair[0];
    return uses(v);
  });
  attempt(label + " in a record", () => {
    const record: Record<string, int32> = { a: n };
    const v: int32 = record.a;
    return uses(v);
  });
  attempt(label + " in a row", () => {
    const row: Row = { cells: [n, 2], ends: [1, n], named: { key: n } };
    return [firstCell(row), width(row), plainWidth(row), named(row, "key"), named(row, "none"), JSON.stringify(row)];
  });
  attempt(label + " spread", () => {
    const list: int32[] = [...[n], ...[2]];
    const v: int32 = list[0];
    return uses(v);
  });
}

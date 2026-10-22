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

function sameAfterOr(n: number): n is int32 {
  return (n | 0) === n;
}
function wholeAndSmall(n: number): n is int32 {
  return Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;
}
function always(n: number): n is int32 {
  return true;
}
function assertInt(n: number): asserts n is int32 {
  if (n !== n) throw new RangeError("not a number");
}
function exact(n: number): n is int32 {
  return Object.is(n | 0, n);
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " the same after | 0", () => (sameAfterOr(n) ? uses(n) : "refused"));
  attempt(label + " whole and small", () => (wholeAndSmall(n) ? uses(n) : "refused"));
  attempt(label + " always yes", () => (always(n) ? uses(n) : "refused"));
  attempt(label + " asserted", () => {
    assertInt(n);
    return uses(n);
  });
  attempt(label + " exact", () => (exact(n) ? uses(n) : "refused"));
  attempt(label + " kept in a variable", () => {
    let kept: int32 = 0;
    if (sameAfterOr(n)) kept = n;
    return uses(kept);
  });
  attempt(label + " filtered", () => {
    const list: int32[] = [n, 1].filter(always);
    return uses(list[0]);
  });
}

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

function total(list: int32[]): int32 {
  let sum: int32 = 0;
  for (const v of list) sum = (sum + v) | 0;
  return sum;
}
function plainTotal(list: int32[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function last(list: int32[]): int32 {
  let kept: int32 = 0;
  for (let i = 0; i < list.length; i++) kept = list[i];
  return kept;
}
function largest(list: int32[]): int32 {
  let best: int32 = -2147483648;
  for (const v of list) if (v > best) best = v;
  return best;
}
function doubled(list: int32[]): number[] {
  return list.map(v => v * 2);
}
function halves(list: int32[]): int32[] {
  return list.map(v => v >> 1);
}

const honest: int32[] = [1, 2, 3, 2147483647, -2147483648];
let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += total(honest) + last(honest) + largest(honest) + doubled(honest).length;
console.log("2000 honest rounds", rounds);

const renamed: int32[] = odd;
attempt("the same array", () => [renamed === odd, renamed]);
attempt("total", () => total(renamed));
attempt("plain total", () => plainTotal(renamed.slice(0, 4)));
attempt("last", () => uses(last(renamed)));
attempt("largest", () => uses(largest(renamed.slice(0, 6))));
attempt("doubled", () => doubled(renamed));
attempt("halves", () => halves(renamed));
for (let i = 0; i < renamed.length; i++) {
  attempt("element " + i, () => {
    const v: int32 = renamed[i];
    return uses(v);
  });
}
attempt("one by one", () => renamed.map(v => last([1, v])));
attempt("sorted by a typed comparison", () => renamed.slice(0, 6).sort((a: int32, b: int32) => (a < b ? -1 : a > b ? 1 : 0)));
attempt("honest again", () => [total(honest), last(honest), largest(honest), halves(honest)]);

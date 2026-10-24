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

function at(list: int32[], index: int32): int32 {
  return list[index];
}
function firstOf(...rest: int32[]): int32 {
  return rest[0];
}
function sum(list: int32[]): int32 {
  let total: int32 = 0;
  for (let i = 0; i < list.length; i++) total = (total + list[i]) | 0;
  return total;
}
function plainSum(list: int32[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

const full: int32[] = [10, 20, 30];
let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += at(full, (i % 3) | 0) + sum(full) + firstOf(1, 2);
console.log("2000 honest rounds", rounds);

attempt("past the end", () => uses(at(full, 3)));
attempt("before the start", () => uses(at(full, -1)));
attempt("far past the end", () => uses(at(full, 2147483647)));
attempt("of an empty list", () => uses(at([], 0)));
attempt("no argument for the rest", () => uses(firstOf()));
attempt("made with a length", () => {
  const list: int32[] = new Array<int32>(3);
  return [list, uses(list[1]), sum(list), plainSum(list)];
});
attempt("a hole in the middle", () => {
  const list: int32[] = [1, 2, 3];
  delete list[1];
  return [list, uses(at(list, 1)), sum(list), plainSum(list)];
});
attempt("the length is raised", () => {
  const list: int32[] = [1, 2];
  list.length = 4;
  return [list, uses(at(list, 3)), sum(list), plainSum(list)];
});
attempt("the length is cut", () => {
  const list: int32[] = [1, 2, 3];
  list.length = 1;
  return [list, uses(at(list, 2)), sum(list)];
});
attempt("an element is deleted", () => {
  const list: int32[] = [1, 2, 3];
  Reflect.deleteProperty(list, 1);
  return [list, uses(at(list, 1)), sum(list), plainSum(list)];
});
attempt("a store far past the end", () => {
  const list: int32[] = [1];
  list[5] = 6;
  return [list, uses(at(list, 3)), sum(list), plainSum(list)];
});
attempt("destructured from a short list", () => {
  const [a, b]: int32[] = [1];
  return [uses(a), uses(b)];
});
attempt("an element that is an accessor", () => {
  const list: int32[] = [1, 2];
  let reads = 0;
  Object.defineProperty(list, 0, { get: () => (reads++ % 2 ? 2147483647 : 5), set() {}, configurable: true });
  if (list[0] < 100) list[0]++;
  return [reads, at(list, 0), at(list, 0), sum(list)];
});
attempt("honest again", () => [at(full, 2), sum(full), firstOf(4)]);

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

console.log(
  "strict:",
  (function (this: unknown) {
    return this === undefined;
  })(),
);

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

function changed(v: int32, to: number): unknown[] {
  arguments[0] = to;
  return uses(v);
}
function poke(list: IArguments, to: number): void {
  list[0] = to;
}
function changedElsewhere(v: int32, to: number): unknown[] {
  poke(arguments, to);
  return uses(v);
}
function changedInALoop(v: int32, to: number): unknown[] {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += v;
    if (i === 0) arguments[0] = to;
  }
  return [sum, v];
}
function halved(v: int32): unknown[] {
  arguments[0] /= 2;
  return uses(v);
}
function raised(v: int32): unknown[] {
  arguments[0]++;
  return uses(v);
}
function seen(v: int32): unknown[] {
  v = (v + 1) | 0;
  return [v, arguments[0], arguments.length];
}
function emptied(v: int32): unknown[] {
  arguments.length = 0;
  Reflect.deleteProperty(arguments, 0);
  return [uses(v), arguments[0]];
}

for (const n of odd) {
  const label = show(n);
  attempt(label + " stored", () => changed(1, n));
  attempt(label + " stored by another function", () => changedElsewhere(1, n));
  attempt(label + " stored in a loop", () => changedInALoop(1, n));
}
attempt("halved", () => [halved(3), halved(4)]);
attempt("raised at the limit", () => [raised(2147483647), raised(1)]);
attempt("seen", () => seen(1));
attempt("emptied", () => emptied(1));
attempt("honest again", () => changed(1, 2));

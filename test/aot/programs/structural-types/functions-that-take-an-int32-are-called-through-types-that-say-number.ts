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

function direct(v: int32): unknown[] {
  return uses(v);
}
function over(v: number): unknown[];
function over(v: int32): unknown[] {
  return uses(v);
}
interface Taker {
  take(v: number): unknown[];
}
class Strict implements Taker {
  take(v: int32): unknown[] {
    return uses(v);
  }
}
class Base {
  take(v: number): unknown[] {
    return ["base", v];
  }
}
class Narrower extends Base {
  take(v: int32): unknown[] {
    return uses(v);
  }
}
function withDefault(v: int32 = 5): unknown[] {
  return uses(v);
}

const renamed: (v: number) => unknown[] = direct;
const inAField: { run: (v: number) => unknown[] } = { run: direct };
const inAList: ((v: number) => unknown[])[] = [direct];
const optional: (v?: number) => unknown[] = withDefault;
const taker: Taker = new Strict();
const base: Base = new Narrower();
function handed(run: (v: number) => unknown[], v: number): unknown[] {
  return run(v);
}

let rounds = 0;
for (let i = 0; i < 2000; i++) rounds += direct(i | 0).length + over(i | 0).length + new Strict().take(i | 0).length + withDefault().length;
console.log("2000 honest rounds", rounds);

for (const n of odd) {
  const label = show(n);
  attempt(label + " under another name", () => renamed(n));
  attempt(label + " out of a field", () => inAField.run(n));
  attempt(label + " out of a list", () => inAList[0](n));
  attempt(label + " handed over", () => handed(direct, n));
  attempt(label + " through an overload", () => over(n));
  attempt(label + " through an interface", () => taker.take(n));
  attempt(label + " through the base class", () => base.take(n));
  attempt(label + " where a default is", () => optional(n));
  attempt(label + " by call", () => direct.call(null, n));
  attempt(label + " by apply", () => direct.apply(null, [n]));
  attempt(label + " bound", () => direct.bind(null, n)());
  attempt(label + " by Reflect.apply", () => Reflect.apply(direct, null, [n]));
}
attempt("nothing where a default is", () => optional());
attempt("undefined where a default is", () => optional(undefined));
attempt("honest again", () => [direct(1), over(2), taker.take(3)]);

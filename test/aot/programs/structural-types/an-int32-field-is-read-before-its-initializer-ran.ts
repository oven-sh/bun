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

const early: unknown[] = [];

class Base {
  constructor() {
    this.start();
  }
  start(): void {}
}
class Counter extends Base {
  count: int32 = 5;
  step: int32 = 2;
  start(): void {
    const count: int32 = this.count;
    early.push(uses(count), Object.keys(this));
    this.count = 8;
  }
  next(): int32 {
    return (this.count + this.step) | 0;
  }
}
class Declared {
  declare never: int32;
  set: int32 = 1;
  both(): number {
    return this.never + this.set;
  }
}
class SelfReading {
  first: int32 = this.later();
  second: int32 = 3;
  later(): int32 {
    return this.second;
  }
}

attempt("read by the base constructor", () => {
  const counter = new Counter();
  return [early.splice(0), counter.count, counter.step, counter.next(), Object.keys(counter)];
});
attempt("after 2000 of them", () => {
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += new Counter().next();
  const kept = early.length;
  const last = early[early.length - 2];
  early.length = 0;
  return [sum, kept, last];
});
attempt("declared and never stored", () => {
  const declared = new Declared();
  return [declared.both(), Object.keys(declared), "never" in declared, typeof declared.never];
});
attempt("a field that reads a later field", () => {
  const self = new SelfReading();
  return [uses(self.first), self.second, Object.keys(self)];
});

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

class Holder {
  p: Point;
  n: number;
  constructor(p: Point, n: number) {
    this.p = p;
    this.n = n;
  }
  all(): number {
    return this.p.x + this.p.y + this.n;
  }
}

function load(name: string) {
  return import("./kinds/" + name + ".js");
}

const honest = await load("honest");
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const p: Point = honest.default();
  const n: number = honest.count;
  warm += sum(p) + plusOne(n) + new Holder(p, n).all();
}
console.log("2000 honest rounds: " + warm);

for (const name of ["honest", "swapped", "texts", "partial", "list", "text", "nothing", "honest"]) {
  const kind = await load(name);
  attempt(name + ", a local", () => {
    const p: Point = kind.default();
    return [p.x, p.y, p.x + p.y, Object.keys(p).join()];
  });
  attempt(name + ", a parameter", () => sum(kind.default()));
  attempt(name + ", fields", () => new Holder(kind.default(), kind.count).all());
  attempt(name + ", an element", () => {
    const list: Point[] = [{ x: 1, y: 2 }, kind.default()];
    return list.map(sum);
  });
  attempt(name + ", a function type", () => {
    const make: () => Point = kind.default;
    return sum(make());
  });
  attempt(name + ", a number", () => {
    const n: number = kind.count;
    return [n + 1, plusOne(n), typeof n];
  });
  attempt(name + ", an export that is not there", () => {
    const n: number = kind.absent;
    return [n, n + 1];
  });
}

try {
  await load("absent");
  console.log("a module that is not there was loaded");
} catch (error) {
  console.log("a module that is not there: " + (error instanceof Error ? "an error" : typeof error));
}

export {};

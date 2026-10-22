import { count, label, Point, total } from "./library.js";
import { kind } from "./view";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
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

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

function sumOf(p: Point): number {
  return p.x + p.y;
}

attempt("a constant", () => [count, typeof count, count + 1, plusOne(count)]);
attempt("a result", () => [label(), typeof label(), label() + "!"]);
attempt("the size of a result", () => size(label()));
attempt("an instance", () => {
  const p = new Point(1, 2);
  return [p.x, p.y, p.x + p.y, sumOf(p), p.sum(), Object.keys(p).join(), JSON.stringify(p)];
});
attempt("a result used in arithmetic", () => [new Point(1, 2).sum() + 1, plusOne(new Point(1, 2).sum()), total([1, 2]) + 1, plusOne(total([1, 2]))]);
attempt("a subclass", () => {
  class Point3 extends Point {
    z = 3;
    all(): number {
      return this.x + this.y + this.z;
    }
  }
  const p = new Point3(1, 2);
  return [p.all(), Object.keys(p).join()];
});
attempt("a name with two files behind it", () => [kind, typeof kind, kind + 1, plusOne(kind)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sumOf({ x: i, y: 1, sum: () => 0 }) + plusOne(i);
console.log("2000 honest rounds: " + warm);
attempt("after them", () => [sumOf(new Point(1, 2)), plusOne(count)]);

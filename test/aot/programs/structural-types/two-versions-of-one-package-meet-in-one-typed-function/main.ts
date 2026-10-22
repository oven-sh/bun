import * as a from "maker-a";
import * as b from "maker-b";
import { isPoint as isPoint1, Point } from "shapes-v1";
import { isPoint as isPoint2, Point as Point2 } from "shapes-v2";

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

function sum(p: Point): number {
  return p.x + p.y;
}

function norm(p: Point): number {
  return p.norm();
}

function describe(p: Point): unknown {
  return [p.x, p.y, sum(p), norm(p), p instanceof Point, p instanceof Point2, isPoint1(p), isPoint2(p), Object.keys(p).join(), JSON.stringify(p)];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(a.make(i, 1)) + norm(a.make(i, 1)) + a.normOf(new Point(i, 1));
console.log("2000 rounds with the first version: " + warm);

attempt("the first version", () => describe(a.make(3, 4)));
attempt("the second version in a function of the first", () => describe(b.make(3, 4)));
attempt("each maker measures the other's point", () => [a.normOf(b.make(3, 4)), b.normOf(b.make(3, 4)), a.normOf(a.make(3, 4))]);
attempt("added across versions", () => {
  const mixed = a.make(1, 2).plus(b.make(3, 4));
  const other = b.make(1, 2).plus(b.make(3, 4));
  return [describe(mixed), describe(other)];
});
attempt("in one list", () => {
  const points: Point[] = [a.make(3, 4), b.make(3, 4), new Point(3, 4), new Point2(3, 4)];
  return [points.map(norm), points.map(sum), points.map(p => p.constructor === Point)];
});
attempt("in a field and a map", () => {
  class Holder {
    constructor(public p: Point) {}
    norm(): number {
      return this.p.norm() + this.p.x;
    }
  }
  const map = new Map<string, Point>([
    ["a", a.make(3, 4)],
    ["b", b.make(3, 4)],
  ]);
  return [new Holder(a.make(3, 4)).norm(), new Holder(b.make(3, 4)).norm(), [...map.values()].map(norm)];
});
attempt("what only the second version has", () => [b.labelOf(b.make(1, 2)), Reflect.get(b.make(1, 2), "label"), Reflect.get(a.make(1, 2), "label")]);
attempt("the first version again", () => describe(a.make(3, 4)));

/// <reference path="./types/legacy.d.ts" />
import legacy, { call, limit, make, Widget } from "legacy";
import { extra } from "legacy/extra";

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

interface Point {
  x: number;
  y: number;
}

function plusOne(n: number): number {
  return n + 1;
}

function sum(p: Point): number {
  return p.x + p.y;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const n: number = make("number");
  const p: Point = make("point");
  warm += plusOne(n) + sum(p) + call(plusOne, i);
}
console.log("2000 honest rounds: " + warm);

for (const kind of ["number", "text", "nothing", "point", "texts", "list", "unknown"]) {
  attempt(kind + " as a number", () => {
    const n: number = make(kind);
    return [n + 1, plusOne(n), typeof n];
  });
  attempt(kind + " as a point", () => {
    const p: Point = make(kind);
    return [p.x, sum(p)];
  });
}
attempt("a constant", () => {
  const n: number = limit;
  return [n + 1, plusOne(limit)];
});
attempt("a class", () => {
  const widget = new Widget("wide");
  const width: number = widget.width;
  const grown: number = widget.grow();
  return [width + 1, grown + 1, Object.keys(widget).join()];
});
attempt("typed functions are called from there", () => [call(plusOne, "1"), call(plusOne), call(sum, { x: "1", y: 2 }), call(sum, [1, 2])]);
attempt("the default", () => {
  const n: number = legacy();
  return n + 1;
});
attempt("a file below it", () => {
  const numbers: number[] = extra;
  return numbers.map(plusOne);
});
attempt("a subclass", () => {
  class Wide extends Widget {
    extra = 1;
    constructor(width: number) {
      super(width);
    }
  }
  const wide = new Wide(2);
  const grown: number = wide.grow();
  return [grown + wide.extra, Object.keys(wide).join()];
});

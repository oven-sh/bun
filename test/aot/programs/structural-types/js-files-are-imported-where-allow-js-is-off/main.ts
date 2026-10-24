import { current, make, Pixel, setCurrent, tagged } from "./library.js";

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
  const p: Point = new Pixel(i, 1);
  warm += plusOne(n) + sum(p) + sum(make("point"));
}
console.log("2000 honest rounds: " + warm);

attempt("a tagged result", () => {
  const n: number = tagged();
  return [n + 1, plusOne(tagged())];
});
for (const kind of ["number", "text", "point", "texts", "unknown"]) {
  attempt(kind + " as a number", () => plusOne(make(kind)));
  attempt(kind + " as a point", () => sum(make(kind)));
}
attempt("a class", () => {
  const p: Point = new Pixel("1", 2);
  return [sum(p), Object.keys(p).join(), new Pixel(1, 2).sum() + 1];
});
attempt("a variable that changes", () => {
  const before: number = current;
  setCurrent("changed");
  const after: number = current;
  return [before + 1, after + 1, plusOne(current)];
});

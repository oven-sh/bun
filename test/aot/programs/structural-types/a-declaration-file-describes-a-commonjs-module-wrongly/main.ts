import * as library from "./library.cjs";
import { count, Dog, fill, later, lazy, settings, twice } from "./library.cjs";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

attempt("honest", () => plusOne(1));
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i);
console.log("2000 honest rounds", warm);

attempt("a constant", () => [count, plusOne(count), library.count, typeof count]);
attempt("a function", () => [twice(2), plusOne(twice(2)), library.twice(2)]);
attempt("an object", () => [settings.depth, plusOne(settings.depth), settings.width, plusOne(settings.width)]);
attempt("a getter of the exports object", () => [library.lazy, library.lazy, plusOne(library.lazy), plusOne(library.lazy)]);
attempt("the getter as a named import", () => [lazy, lazy, plusOne(lazy)]);
attempt("a constructor function for a class", () => {
  const d = new Dog();
  return [d.legs, plusOne(d.legs), Object.keys(d), d instanceof Dog];
});
attempt("a method that is not there", () => new Dog().bark());
attempt("before fill", () => [later, library.later, plusOne(later)]);
fill();
attempt("after fill", () => [later, library.later, plusOne(library.later), count, library.count, plusOne(library.count)]);
attempt("the keys", () => Object.keys(library).sort());

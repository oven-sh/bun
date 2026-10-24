import { ways, withNothing } from "./caller.js";
import { Cursor, lineOf, uses } from "./typed.ts";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(i | 0).length + lineOf(new Cursor(i | 0));
console.log("2000 honest rounds", warm);

const values: unknown[] = [3, 1.5, -0, NaN, 2 ** 31, -(2 ** 31) - 1, 1e21, Infinity, "7", null, undefined, true, [5], {}];
for (const [label, run] of Object.entries(ways)) {
  for (const value of values) attempt(label + " " + show(value), () => run(value));
}
attempt("with nothing", () => withNothing());
attempt("a bigint", () => ways["out of a table"](5n));
attempt("honest again", () => [uses(2), lineOf(new Cursor(9))]);

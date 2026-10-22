import * as barrel from "./barrel";
import { Alone, Color, Level, Name, OnlyTypes, Pair, Shape, Square, WithValues } from "./barrel";
import * as local from "./through-a-local-name";

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

const shape: Shape = new Square();
const name: Name = "n";
const alone: Alone = { n: 1 };
const pair: Pair = [1, 2];
const inner: OnlyTypes.Inner = { depth: 1 };

attempt("what the barrel holds", () => Object.keys(barrel).sort());
attempt("what the other file holds", () => Object.keys(local).sort());
attempt("values", () => [shape.sides, name, alone.n, pair[0] + pair[1], inner.depth, Color.Green, Color[1], Level.High, WithValues.depth]);
attempt("names that are only types, asked for at run time", () => ["Shape" in barrel, "Alone" in barrel, "OnlyTypes" in barrel, "Level" in barrel, "default" in local, Reflect.get(barrel, "Shape"), Reflect.get(local, "default")]);
attempt("the same class through both", () => [local.Square === Square, new local.Square() instanceof barrel.Square]);

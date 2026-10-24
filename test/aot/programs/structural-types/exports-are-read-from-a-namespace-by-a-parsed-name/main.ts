import * as common from "./common.cjs";
import * as typed from "./typed";
import * as untyped from "./untyped.js";

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

const names: string[] = JSON.parse('["first","second","third","Fourth","fifth","setFifth","default","hidden","missing"]');
const spaces: [string, object][] = [
  ["typed", typed],
  ["untyped", untyped],
  ["common", common],
];

for (const [label, space] of spaces) {
  attempt("the names of " + label, () => Object.keys(space).sort());
  for (const name of names) {
    attempt(label + "." + name, () => {
      const member = Reflect.get(space, name);
      if (typeof member !== "function") return [typeof member, member];
      if (name === "Fourth") return new member(1).get();
      const result: number = member(1);
      return [typeof result, result, plusOne(result)];
    });
  }
}

attempt("a live binding read by name", () => {
  const before: number = Reflect.get(typed, names[4]);
  Reflect.get(typed, names[5])("five");
  const after: number = Reflect.get(typed, names[4]);
  return [before + 1, after + 1, typed.fifth];
});
attempt("a store to a namespace", () => Reflect.set(typed, "fifth", 1));
attempt("what a namespace is", () => [Object.isFrozen(typed), Object.isSealed(typed), Object.isExtensible(typed), Object.prototype.toString.call(typed), Reflect.getPrototypeOf(typed)]);

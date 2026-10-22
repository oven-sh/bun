import * as library from "./library.cjs";
import { Arrow, Build, bump, callable, count, counter, Factory, getter, label, list, settings, tools } from "./library.cjs";

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

attempt("a function for a class", () => {
  const made = new Factory(1);
  return [made.width, made.width + 1, made.grow(), plusOne(made.grow()), made instanceof Factory, Object.keys(made).join()];
});
attempt("a function for a class, extended", () => {
  class Wide extends Factory {
    extra = 1;
    both(): number {
      return this.width + this.extra;
    }
  }
  const wide = new Wide(1);
  return [Object.keys(wide).join(), wide instanceof Wide, typeof wide.both];
});
attempt("a class for a function", () => Build(1).width);
attempt("an arrow for a class", () => new Arrow().n);
attempt("a number for a text and a text for a number", () => [count, count + "!", label, label + 1, plusOne(label)]);
attempt("the size of a text that is a number", () => size(count));
attempt("members that are not there", () => [typeof library.missing, library.absent, library.absent + 1, plusOne(library.absent), typeof library.Gone]);
attempt("a function that is not there, called", () => library.missing());
attempt("a class that is not there, constructed", () => new library.Gone());
attempt("a function for a namespace", () => [typeof tools, tools.limit, tools.limit + 1, plusOne(tools.limit), typeof tools.plusOne]);
attempt("a function of the namespace", () => tools.plusOne(1));
attempt("a class for an object", () => [typeof settings, settings.depth, settings.depth + 1, settings.name, size(settings.name)]);
attempt("an object for a function", () => [typeof callable, callable.call(undefined, 1), callable.apply(undefined, [1])]);
attempt("an object for a function, called", () => callable(1));
attempt("a set for a list", () => [typeof list, list.length, list[0], Array.isArray(list)]);
attempt("a set for a list, iterated", () => {
  let total = 0;
  for (const n of list) total += n;
  return total;
});
attempt("a set for a list, mapped", () => list.map(plusOne));
attempt("a getter for a constant", () => [typeof getter, typeof library.getter, library.getter < library.getter]);
attempt("a variable that changes", () => {
  const before = [counter, library.counter];
  bump();
  return [before, counter, library.counter, typeof library.counter];
});

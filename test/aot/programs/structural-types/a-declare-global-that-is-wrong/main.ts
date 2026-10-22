import "./globals.ts";
import { change } from "./setup.js";

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

function half(n: number): number {
  return n / 2;
}

attempt("honest", () => [plusOne(1), half(4)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + half(i);
console.log("2000 honest rounds", warm);

attempt("a global variable: read", () => [buildNumber, typeof buildNumber, globalThis.buildNumber]);
attempt("a global variable: arithmetic", () => [buildNumber + 1, plusOne(buildNumber), half(buildNumber), buildNumber === 17, buildNumber > 16]);
attempt("a global variable: a local, a field, an element", () => {
  const n: number = buildNumber;
  class Holder {
    n = buildNumber;
  }
  const list: number[] = [buildNumber, 1];
  return [n + 1, new Holder().n + 1, list];
});
attempt("a global variable: in a loop", () => {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += buildNumber;
  return sum;
});
attempt("a global object", () => [featureFlags.fast, featureFlags.fast ? "fast" : "slow", featureFlags.fast === true, featureFlags.level, featureFlags.level + 1]);
attempt("a global list: length and element", () => [registry.length, registry[0].length, Array.isArray(registry)]);
attempt("a global list: a method", () => registry.join("+"));
attempt("a global list: iterated", () => [...registry]);
attempt("a global function", () => [double(4), double(4) + 1, half(double(4)), typeof double(4), [1, 2].map(double)]);
attempt("a global function that is not there", () => missing(1));
attempt("a global function that is not there: typeof", () => typeof missing);
attempt("a global constant with a literal type", () => [fixedLimit, fixedLimit === 10, fixedLimit + 1, half(fixedLimit)]);
attempt("a global constant that is not there", () => neverSet + 1);
attempt("a global constant that is not there: typeof", () => typeof neverSet);
attempt("a global class: fields", () => {
  const g = new Gadget(3);
  return [g.size, g.size + 1, Object.keys(g)];
});
attempt("a global class: a method", () => [new Gadget(3).grow(), new Gadget(3).grow() + 1]);
attempt("a global class: a method that is not there", () => new Gadget(3).shrink());
attempt("a global class: extended", () => {
  class Big extends Gadget {
    extra = 1;
    grow(): number {
      return super.grow() + this.extra;
    }
  }
  return [new Big(1).grow(), Object.keys(new Big(1))];
});
attempt("a member added to Math", () => [Math.half(4), Math.half(4) + 1, plusOne(Math.half(4))]);
attempt("a member of Math that is not there", () => Math.third(3));
attempt("stored to", () => {
  buildNumber = 5;
  const first = buildNumber + 1;
  globalThis.buildNumber = 6;
  return [first, buildNumber + 1];
});
change();
attempt("after the other module changed them: the variable", () => [buildNumber, buildNumber + 1, typeof buildNumber]);
attempt("after the other module changed them: the object", () => featureFlags.level);
attempt("after the other module changed them: typeof", () => typeof featureFlags);
attempt("honest again", () => [plusOne(1), half(4)]);

import * as os from "node:os";
import * as util from "node:util";

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare module "node:util" {
  const missingLevel: number;
  function missingHelper(n: number): number;
  function isDeepStrictEqual(left: number, right: number): number;
  function format(pattern: number): number;
}

declare module "node:os" {
  const missingCores: number;
  function missingName(): string;
}

function plusOne(n: number): number {
  return n + 1;
}

show("honest callers", () => [plusOne(1), util.format("%s-%s", "a", "b"), util.isDeepStrictEqual([1], [1]), typeof os.EOL]);
show("a number that is not there", () => [util.missingLevel, typeof util.missingLevel, util.missingLevel + 1, plusOne(util.missingLevel)]);
show("typeof a function that is not there", () => typeof util.missingHelper);
show("called", () => util.missingHelper(1));
show("a function that is there is typed number", () => [util.isDeepStrictEqual(1, 1), typeof util.isDeepStrictEqual(1, 1), util.isDeepStrictEqual(1, 1) + 1, plusOne(util.isDeepStrictEqual(1, 2))]);
show("another one", () => [util.format(5), typeof util.format(5), util.format(5) + 1, plusOne(util.format(5))]);
show("in another module", () => [os.missingCores, os.missingCores + 1, typeof os.missingName]);
show("called", () => os.missingName());
show("in", () => ["missingLevel" in util, "format" in util, "missingCores" in os]);

let nans = 0;
for (let i = 0; i < 2000; i++) if (Number.isNaN(plusOne(util.missingLevel)) && Number.isNaN(os.missingCores + i)) nans++;
show("2000 rounds", () => nans);

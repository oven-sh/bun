import * as library from "./library.ts";
import { Mode, Shapes } from "./library.ts";
import { addedPlusOne } from "./more.ts";

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

function plusOne(n: number): number {
  return n + 1;
}

show("the real ones", () => [library.real, library.realTwice(2), Shapes.sides, Mode.On]);
show("the added number", () => [library.added, typeof library.added, library.added + 1, plusOne(library.added)]);
show("the added number in the file that added it", () => addedPlusOne());
show("the added text", () => library.addedTitle);
show("the length of the added text", () => library.addedTitle.length);
show("the added function", () => typeof library.addedThrice);
show("the added function called", () => library.addedThrice(1));
show("a member added to the namespace", () => [Shapes.corners, Shapes.corners + Shapes.sides, Object.keys(Shapes)]);
show("a function added to the enum", () => typeof Mode.parse);
show("that function called", () => Mode.parse("On"));
show("keys of the enum", () => Object.keys(Mode));
show("keys of the module", () => Object.keys(library));
show("in", () => ["added" in library, "real" in library]);

let nans = 0;
for (let i = 0; i < 2000; i++) if (Number.isNaN(addedPlusOne()) && Number.isNaN(Shapes.corners + i)) nans++;
show("2000 rounds", () => nans);

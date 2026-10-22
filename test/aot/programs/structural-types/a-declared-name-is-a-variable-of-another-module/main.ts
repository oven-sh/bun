import { rename, report } from "./other.ts";

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

declare const hiddenCount: number;
declare let hiddenTitle: string;
declare function hiddenHelper(n: number): number;
declare class HiddenBox {
  value: number;
}

show("the other module has them", () => report());
show("typeof here", () => [typeof hiddenCount, typeof hiddenTitle, typeof hiddenHelper, typeof HiddenBox]);
show("the constant", () => hiddenCount);
show("the constant plus one", () => hiddenCount + 1);
show("the variable", () => hiddenTitle);
show("a store to the variable", () => (hiddenTitle = "stored from main"));
show("the function", () => hiddenHelper(1));
show("the class", () => new HiddenBox().value);
show("the other module is untouched", () => report());

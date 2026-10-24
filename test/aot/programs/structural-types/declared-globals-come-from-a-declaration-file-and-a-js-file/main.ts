/// <reference path="./globals.d.ts" />
import "./setup.js";

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

function lengthOf(s: string): number {
  return s.length;
}

function depthOf(options: AppOptions): number {
  return options.depth;
}

show("honest callers", () => [plusOne(1), lengthOf("ab"), depthOf({ depth: 2 })]);
show("the number is text", () => [appVersion, typeof appVersion, appVersion + 1, plusOne(appVersion), appVersion * 2]);
show("the text is a list", () => [appName, typeof appName, lengthOf(appName), appName + "!"]);
show("the text in capitals", () => appName.toUpperCase());
show("the function answers text", () => [appStart(80), typeof appStart(80), plusOne(appStart(80))]);
show("the one that is not there", () => appMissing);
show("typeof the one that is not there", () => typeof appMissing);
show("a member of the namespace is null", () => [App.retries, App.retries + 1, plusOne(App.retries)]);
show("a function of the namespace is not there", () => App.stop());
show("the object", () => [appOptions.depth, depthOf(appOptions), depthOf(appOptions) + 1, Object.keys(appOptions)]);
show("a store", () => {
  appName = "stored";
  return [appName, lengthOf(appName)];
});
let sum = 0;
for (let i = 0; i < 2000; i++) sum += lengthOf(appName) + depthOf({ depth: i });
show("2000 honest rounds", () => sum);
show("the object again", () => depthOf(appOptions));

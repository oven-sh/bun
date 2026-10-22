/// <reference path="./toolkit.d.ts" />
import * as toolkit from "#toolkit";
import { Gear, limit, twice } from "#toolkit";

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

function wearOf(gear: Gear): number {
  return gear.missingWear;
}

show("what is exported", () => [limit, twice(2), new Gear(3).teeth, plusOne(limit), plusOne(twice(1))]);
show("a number that is not", () => [toolkit.missingLimit, typeof toolkit.missingLimit]);
show("plus one", () => [toolkit.missingLimit + 1, plusOne(toolkit.missingLimit)]);
show("a text that is not", () => toolkit.missingTitle);
show("its length", () => toolkit.missingTitle.length);
show("a list that is not", () => toolkit.missingList);
show("its length", () => toolkit.missingList.length);
show("typeof a function that is not", () => typeof toolkit.missingThrice);
show("called", () => toolkit.missingThrice(1));
show("a class that is not", () => new toolkit.MissingWheel());
show("instanceof it", () => ({}) instanceof toolkit.MissingWheel);
show("a member the class never makes", () => [new Gear(1).missingWear, wearOf(new Gear(1)), wearOf(new Gear(1)) + 1]);
show("a method the class never had", () => new Gear(1).missingTurn());
show("a static method the class never had", () => Gear.missingMake());
show("keys of an instance", () => Object.keys(new Gear(1)));
show("keys of the module", () => Object.keys(toolkit));
show("in", () => ["missingLimit" in toolkit, "limit" in toolkit]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += twice(i) + new Gear(i).teeth + limit;
show("2000 honest rounds", () => sum);
show("a number that is not, again", () => plusOne(toolkit.missingLimit));

import Point from "./class.cjs";
import plusOne from "./function.cjs";
import marked, { other } from "./marked.cjs";
import * as markedNamespace from "./marked.cjs";
import answer from "./number.cjs";
import settings from "./object.cjs";
import * as settingsNamespace from "./object.cjs";
import wrong from "./wrong.cjs";
import required = require("./function.cjs");
import RequiredPoint = require("./class.cjs");
import requiredMarked = require("./marked.cjs");

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

attempt("a function", () => [typeof plusOne, plusOne(1), plusOne.version, plusOne === required, required(2)]);
attempt("a class", () => {
  const p = new Point(1, 2);
  return [typeof Point, p.sum(), p instanceof RequiredPoint, Point === RequiredPoint, Object.keys(p).join()];
});
attempt("a subclass", () => {
  class Point3 extends Point {
    z = 3;
  }
  const p = new Point3(1, 2);
  return [p.sum() + p.z, Object.keys(p).join()];
});
attempt("an object", () => [typeof settings, settings.limit + 1, settings.name, settings.default, Object.keys(settings).join()]);
attempt("an object as a namespace", () => [settingsNamespace.limit + 1, settingsNamespace.name, typeof settingsNamespace.default, Object.keys(settingsNamespace).sort().join()]);
attempt("a file marked as an es module", () => [typeof marked, typeof other, other + 1, Object.keys(markedNamespace).sort().join(), typeof markedNamespace.default]);
attempt("a file marked as an es module, called", () => marked());
attempt("a file marked as an es module, required", () => [typeof requiredMarked, typeof requiredMarked.default, requiredMarked.other, requiredMarked.default()]);
attempt("a number", () => [typeof answer, answer + 1]);
attempt("a declaration that is wrong", () => [typeof wrong, Object.keys(wrong).join()]);
attempt("a declaration that is wrong, called", () => wrong(1) + 1);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + new Point(i, 1).sum() + settings.limit + answer;
console.log("2000 rounds: " + warm);

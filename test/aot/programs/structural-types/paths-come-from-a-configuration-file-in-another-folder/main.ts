import { bump, count, Token } from "@lib/counter";
import { sum } from "@lib/shapes";
import Pixel from "assigned";
import { make, where } from "fields";
import * as direct from "./lib/counter";
import * as alias from "same-file";
import Required = require("assigned");

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

attempt("one file under three names", () => [bump(), direct.bump(), alias.bump(), count, direct.count, alias.count, direct.Token === Token, alias.Token === Token, new alias.Token() instanceof Token]);
attempt("which build of the package", () => [where, where === "module"]);
attempt("what it makes", () => [make().x, make().x + make().y, sum(make()), Object.keys(make()).join()]);
attempt("required", () => {
  const fields = require("fields");
  const p: { x: number; y: number } = fields.make();
  return [fields.where, sum(p)];
});
attempt("a class assigned to the exports of a typescript file", () => {
  const p = new Pixel(1, 2);
  return [typeof Pixel, Pixel === Required, p.sum(), sum(p), p instanceof Required, Object.keys(p).join()];
});
attempt("a subclass of it", () => {
  class Pixel3 extends Required {
    z = 3;
  }
  const p = new Pixel3(1, 2);
  return [p.sum() + p.z, Object.keys(p).join()];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum({ x: i, y: 1 }) + new Pixel(i, 1).sum() + sum(new Required(i, 1));
console.log("2000 rounds: " + warm);

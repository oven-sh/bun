import data from "./data.json";
import { count as namedCount, point as namedPoint } from "./data.json";
import * as whole from "./data.json";
import list from "./list.json";
import answer from "./number.json";
import { seenHere, spoil } from "./other-importer.ts";

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

function size(s: string): number {
  return s.length;
}

function total(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

attempt("numbers", () => [data.count, plusOne(data.count), data.ratio, data.minusZero, 1 / data.minusZero, data.big, data.huge, plusOne(data.huge)]);
attempt("strings", () => [data.name, size(data.name), data.empty, size(data.empty)]);
attempt("others", () => [data.flag, data.nothing, data.flag ? "yes" : "no", data.nothing ?? "defaulted"]);
attempt("a list", () => [total(data.list), data.list, data.list.map(plusOne), Array.isArray(data.list)]);
attempt("a mixed list", () => data.mixed.map(v => typeof v));
attempt("an empty list", () => [data.none.length, data.none]);
attempt("an object", () => [sum(data.point), Object.keys(data.point), JSON.stringify(data.point)]);
attempt("the order of the keys", () => Object.keys(data));
attempt("numeric keys", () => [data[10], data["2"], data[2]]);
attempt("a key named __proto__", () => [Object.hasOwn(data, "__proto__"), Object.getPrototypeOf(data) === Object.prototype, "polluted" in data, JSON.stringify(data["__proto__"])]);
attempt("a key named constructor", () => [data.constructor, typeof data.constructor]);
attempt("a key written twice", () => [data.again, typeof data.again]);
attempt("rows of different shapes", () => data.rows.map(r => r.id + ":" + r.tag + ":" + Object.keys(r).join()));
attempt("rows: an optional member", () => data.rows.map(r => (r.tag === undefined ? -1 : r.tag.length)));
attempt("named imports", () => [namedCount, plusOne(namedCount), sum(namedPoint), namedPoint === data.point]);
attempt("the namespace", () => [whole.count, whole.point === data.point, Object.keys(whole).length > 5]);
attempt("a list at the top", () => [total(list), list.length, list]);
attempt("a number at the top", () => [answer, plusOne(answer)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(data.count) + total(data.list) + sum(data.point) + size(data.name) + total(list) + namedCount;
console.log("2000 honest rounds", warm);

spoil();
attempt("after another importer stored to it: here", () => [data.count, data.list, data.point.x, list]);
attempt("after another importer stored to it: there", () => seenHere());
attempt("after: arithmetic", () => [plusOne(data.count), data.count + 1, total(data.list), sum(data.point), total(list)]);
attempt("after: the named imports", () => [namedCount, plusOne(namedCount), sum(namedPoint)]);
attempt("after: the namespace", () => [whole.count, plusOne(whole.count), whole.list.length]);
attempt("frozen?", () => [Object.isFrozen(data), Object.isFrozen(data.list), Object.isExtensible(data)]);
const late: { default: { count: number | string } } = await import("./data.json");
attempt("imported again later", () => [late.default === data, late.default.count]);

import { bag, current, later, list, nothing, setCurrent, setLater, setNothing, table } from "./library.js";

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
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

function sum(p: Point): number {
  return p.x + p.y;
}

function total(numbers: number[]): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

function currentAsNumber(): unknown {
  const n: number = current;
  return [n, typeof n, n + 1, plusOne(n)];
}

function currentAsPoint(): unknown {
  const p: Point = current;
  return [p.x, sum(p)];
}

attempt("before anything is stored", () => [currentAsNumber(), nothing, later]);

setCurrent(1);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  setCurrent(i);
  const n: number = current;
  warm += plusOne(n);
}
console.log("2000 honest rounds: " + warm);

for (const value of [3, "3", null, undefined, true, [3], { valueOf: () => 3 }, { x: 1, y: 2 }, { x: "1", y: "2" }]) {
  setCurrent(value);
  attempt("current is " + show(value) + ", as a number", currentAsNumber);
  attempt("current is " + show(value) + ", as a point", currentAsPoint);
}

function describeNothing(): unknown {
  return [nothing === null, nothing == undefined, typeof nothing, nothing ?? "fallback", nothing ? "truthy" : "falsy", String(nothing), JSON.stringify([nothing])];
}

function describeLater(): unknown {
  return [later === undefined, later == null, typeof later, later ?? "fallback", later ? "truthy" : "falsy", String(later), JSON.stringify([later])];
}

attempt("a variable whose only type is null", describeNothing);
attempt("a variable whose only type is undefined", describeLater);
for (const value of [0, "text", { x: 1 }, false, undefined, null]) {
  setNothing(value);
  setLater(value);
  attempt("a variable whose only type is null holds " + show(value), describeNothing);
  attempt("a variable whose only type is undefined holds " + show(value), describeLater);
}
attempt("a list that started empty", () => {
  list.push(1, "2", null);
  const numbers: number[] = list;
  return [total(numbers), numbers.map(plusOne), numbers.length];
});
attempt("a list that started empty, as points", () => {
  list.length = 0;
  list.push({ x: 1, y: 2 }, { x: "3" }, 4);
  const points: Point[] = list;
  return points.map(sum);
});
attempt("an empty literal gets members", () => {
  Object.assign(bag, { x: "1", y: 2 });
  return [Object.keys(bag).join(), JSON.stringify(bag)];
});
attempt("a table without a prototype", () => {
  const first: number = table.first;
  const second: number = table.second;
  const text: string = table.toString;
  return [first + 1, second + 1, text];
});

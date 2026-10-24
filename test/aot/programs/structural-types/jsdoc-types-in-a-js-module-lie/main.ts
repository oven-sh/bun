import { callBack, count, Dog, label, Level, list, point, row, step, wrap } from "./library.js";

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

function half(n: number): number {
  return n / 2;
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

attempt("honest", () => [half(4), plusOne(1), size("ab"), total([1, 2])]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(i) + plusOne(i) + size("ab") + total([i]);
console.log("2000 honest rounds", warm);

attempt("a result", () => [count(), plusOne(count()), half(count()), typeof count()]);
attempt("a result in a local, a field and an element", () => {
  const n: number = count();
  class Holder {
    n = count();
  }
  const values: number[] = [count()];
  return [n + 1, new Holder().n + 1, total(values)];
});
attempt("a string result", () => [label(5), label(5) + "!", typeof label(5)]);
attempt("a string result: size", () => size(label(5)));
attempt("a list", () => [total(list), list.length, Array.isArray(list)]);
attempt("a list: a method", () => list.map(plusOne));
attempt("a point", () => [point.x + point.y, point.x, Object.keys(point)]);
attempt("a function", () => [step(1), plusOne(step(1)), [1, 2].map(step)]);
attempt("a row", () => [row().id + 1, row().name, Object.keys(row())]);
attempt("a row: size of the name", () => size(row().name));
attempt("a generic", () => [wrap(5), typeof wrap(5)]);
attempt("a generic: used as a list", () => wrap(5).length);
attempt("a generic: a method", () => wrap(5).map(plusOne));
attempt("a class", () => [new Dog().legs, new Dog().legs + 1, half(new Dog().legs), new Dog().bark(), plusOne(new Dog().bark())]);
attempt("a callback", () => callBack(half));
attempt("a callback that adds", () => callBack(plusOne));
attempt("an enum in a comment", () => [Level.Low, Level.High, plusOne(Level.Low)]);
attempt("honest again", () => [half(4), plusOne(1), size("ab"), total([1, 2])]);

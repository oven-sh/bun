import { Basket, counter, double, makePoint, settings, sizes, spoil, total } from "./library.js";

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

attempt("honest", () => [plusOne(1), size("ab"), double(2), total([1, 2]), makePoint(1, 2).x, new Basket().add(1), counter.next(), sizes.small]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(double(i)) + total([i, 1]) + makePoint(i, 1).x + sizes.small;
console.log("2000 honest rounds", warm);

attempt("inferred results", () => [plusOne(double(2)), plusOne(total([1, 2])), plusOne(makePoint(1, 2).y), size(settings.name), plusOne(settings.depth)]);
attempt("an inferred class", () => {
  const b = new Basket();
  b.add(1);
  b.add(2);
  return [b.items, plusOne(b.sum()), Object.keys(b)];
});
spoil();
attempt("after the module spoiled its own values: settings", () => [settings.depth, plusOne(settings.depth), settings.name]);
attempt("after: a string member", () => size(settings.name));
attempt("after: sizes", () => [sizes.small, plusOne(sizes.small)]);
attempt("after: the counter", () => [counter.next(), plusOne(counter.next())]);
attempt("after: double", () => [double(2), plusOne(double(2))]);
attempt("after: a basket", () => {
  const b = new Basket();
  b.add(1);
  return [b.items, b.sum(), plusOne(b.sum())];
});
attempt("honest again", () => [plusOne(1), size("ab")]);

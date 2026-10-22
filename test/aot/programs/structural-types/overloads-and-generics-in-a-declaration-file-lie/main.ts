import { assertText, first, get, identity, isNumber, make, mapAll, pair, Store } from "./library.js";

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

attempt("honest", () => [plusOne(1), size("ab")]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab");
console.log("2000 honest rounds", warm);

attempt("an overload that promises a number", () => [get("count"), plusOne(get("count")), typeof get("count")]);
attempt("an overload that promises a string", () => [get("name"), get("name") + "!", typeof get("name")]);
attempt("an overload that promises a string: size", () => size(get("name")));
attempt("an overload that promises a list", () => get("list").length);
attempt("identity of a number", () => [identity(5), plusOne(identity(5)), typeof identity(5)]);
attempt("identity of a string", () => [identity("abc"), typeof identity("abc")]);
attempt("identity of a string: size", () => size(identity("abc")));
attempt("identity of an object", () => {
  const p = identity({ x: 1 });
  return [p.x, plusOne(p.x), Object.keys(p)];
});
attempt("first of a list", () => [typeof first([1, 2]), plusOne(first([1, 2]))]);
attempt("mapAll swaps the arguments", () => mapAll(["a", "bb"], (item, index) => typeof item + ":" + typeof index));
attempt("mapAll: the callback uses its parameters", () => mapAll(["a", "bb"], (item, index) => item.length + index));
attempt("mapAll: a named typed callback", () => {
  const measure = (item: string, index: number): number => item.length * 10 + index;
  return [measure("ab", 1), mapAll(["a", "bb"], measure)];
});
attempt("make", () => [make("dog").legs, plusOne(make("dog").legs), make("cat").lives, Object.keys(make("dog"))]);
attempt("a guard that always says yes", () => {
  const values: unknown[] = [1, "2", null];
  return values.map(v => (isNumber(v) ? v + 1 : "no"));
});
attempt("an assertion that never throws", () => {
  const v: unknown = 5;
  assertText(v);
  return [v + "!", typeof v];
});
attempt("an assertion that never throws: size", () => {
  const v: unknown = 5;
  assertText(v);
  return size(v);
});
attempt("a pair the wrong way round", () => {
  const [n, s] = pair(1, "one");
  return [typeof n, typeof s, pair(1, "one").length];
});
attempt("a pair the wrong way round: used", () => {
  const [n, s] = pair(1, "one");
  return [plusOne(n), s + "!"];
});
attempt("a pair the wrong way round: a method", () => pair(1, "one")[1].toUpperCase());
attempt("a generic class", () => {
  const store = new Store<string, number>();
  const returned = store.set("a", 1);
  return [typeof returned, store.get("a"), plusOne(store.get("a")), store.size, plusOne(store.size), store.get("b")];
});
attempt("a generic class: chained", () => new Store<string, number>().set("a", 1).set("b", 2).size);
attempt("honest again", () => [plusOne(1), size("ab")]);

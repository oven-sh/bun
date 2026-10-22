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

function plusOne(n: number): number {
  return n + 1;
}

enum Color {
  Red,
  Green = 5,
}

enum Word {
  Yes = "yes",
}

namespace Limits {
  export const depth = 3;
  export let width = 4;
  export function widen(): void {
    width++;
  }
}

const numbers = [1, 2, 3];
const pair: [number, string] = [1, "one"];

attempt("a list", () => [Reflect.get(numbers, 0) + 1, Reflect.get(numbers, "length") + 1, Reflect.get(numbers, 9), plusOne(Reflect.get(numbers, 9)), typeof Reflect.get(numbers, "map")]);
attempt("a list under a text that is an index", () => {
  const key: string = "1";
  const n: number = Reflect.get(numbers, key);
  return n + 1;
});
attempt("a pair", () => [Reflect.get(pair, 0) + 1, Reflect.get(pair, 1).length, Reflect.get(pair, "length") + 1]);
attempt("a pair after pop", () => {
  const short: [number, string] = [1, "one"];
  short.pop();
  const second = Reflect.get(short, 1);
  return [second, typeof second, Reflect.get(short, "length")];
});
attempt("a pair after pop, its length", () => {
  const short: [number, string] = [1, "one"];
  short.pop();
  return Reflect.get(short, 1).length;
});
attempt("a function", () => [Reflect.get(plusOne, "name"), Reflect.get(plusOne, "length") + 1, typeof Reflect.get(plusOne, "call")]);
attempt("enums", () => [Reflect.get(Color, "Red") + 1, Reflect.get(Color, "Green") + 1, Reflect.get(Color, 5), Reflect.get(Color, 7), Reflect.get(Word, "Yes").length]);
attempt("a namespace", () => {
  const before = Reflect.get(Limits, "width");
  Limits.widen();
  Reflect.get(Limits, "widen")();
  return [Reflect.get(Limits, "depth") + 1, before + 1, Reflect.get(Limits, "width") + 1];
});
attempt("built-in objects", () => [Reflect.get(Math, "PI") > 3, Reflect.get(Number, "MAX_SAFE_INTEGER") + 1, typeof Reflect.get(JSON, "parse"), Reflect.get(globalThis, "NaN") + 1, typeof Reflect.get(globalThis, "Array")]);
attempt("a map, a set, a date, a regular expression", () => [Reflect.get(new Map([[1, 2]]), "size") + 1, Reflect.get(new Set([1]), "size") + 1, typeof Reflect.get(new Date(0), "getTime"), Reflect.get(/a/g, "flags"), Reflect.get(/a/g, "lastIndex") + 1]);
attempt("a size read for another receiver", () => Reflect.get(new Map([[1, 2]]), "size", {}));
attempt("a typed array and a text object", () => [Reflect.get(new Uint8Array([7]), 0) + 1, Reflect.get(new Uint8Array(2), "length") + 1, Reflect.get(new String("ab"), "length") + 1, Reflect.get(new String("ab"), 0)]);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += Reflect.get(numbers, i % 3) + Reflect.get(numbers, "length") + Reflect.get(pair, 0) + Reflect.get(Color, "Green") + Reflect.get(Limits, "depth");
console.log("2000 rounds: " + warm);

export {};

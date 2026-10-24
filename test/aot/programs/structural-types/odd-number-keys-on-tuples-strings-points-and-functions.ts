function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Point {
  x = 1;
}

function readTuple(tuple: [number, string], key: number): number | string {
  return tuple[key];
}

function readStrings(strings: string[], key: number): string {
  return strings[key];
}

function readPoints(points: Point[], key: number): Point {
  return points[key];
}

function readFunctions(functions: (() => number)[], key: number): () => number {
  return functions[key];
}

function readText(text: string, key: number): string {
  return text[key];
}

let total = 0;
for (let i = 0; i < 2000; i++) total += String(readTuple([i, "a"], i % 2)).length + readStrings(["a", "bc"], i % 2).length + readPoints([new Point()], 0).x + readFunctions([() => i], 0)() + readText("ab", i % 2).length;
console.log("2000 honest rounds: " + total);

const keys = [0, 1, 2, -1, 0.5, -0, NaN, Infinity, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 2 ** 53];
for (const key of keys) {
  console.log("key " + show(key));
  attempt("  a tuple", () => [typeof readTuple([7, "s"], key), readTuple([7, "s"], key)]);
  attempt("  strings", () => [typeof readStrings(["a", "b"], key), readStrings(["a", "b"], key)]);
  attempt("  strings: a method", () => readStrings(["a", "b"], key).toUpperCase());
  attempt("  points", () => typeof readPoints([new Point(), new Point()], key));
  attempt("  points: a member", () => readPoints([new Point(), new Point()], key).x);
  attempt("  functions", () => typeof readFunctions([() => 1, () => 2], key));
  attempt("  functions: called", () => readFunctions([() => 1, () => 2], key)());
  attempt("  a text", () => [typeof readText("ab", key), readText("ab", key)]);
}

const tuple: [number, string] = [7, "s"];
const odd: number[] = [-1, 0.5, NaN, 2 ** 32 - 1];
for (const key of odd) tuple[key] = key;
console.log("a tuple after four stores: length " + tuple.length + ", keys " + Object.keys(tuple).join() + ", " + JSON.stringify(tuple));
attempt("its places", () => [tuple[0] + 1, tuple[1].toUpperCase()]);
attempt("destructured", () => {
  const [a, b] = tuple;
  return [a, b];
});
const minusZero: number = -0;
tuple[minusZero] = "at minus zero";
console.log("a string at minus zero: " + show(tuple) + " " + typeof tuple[0]);
attempt("[0] + 1", () => tuple[0] + 1);
attempt("[0].toFixed", () => tuple[0].toFixed(1));

export {};

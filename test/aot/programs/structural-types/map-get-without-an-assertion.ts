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
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

function orZero(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

function orOne(map: Map<string, number>, key: string): number {
  return map.get(key) || 1;
}

function afterHas(map: Map<string, number>, key: string): number {
  if (map.has(key)) {
    const value = map.get(key);
    return value === undefined ? -1 : value + 1;
  }
  return -2;
}

function bump(map: Map<string, number>, key: string): number {
  const next = (map.get(key) ?? 0) + 1;
  map.set(key, next);
  return next;
}

function xOf(map: Map<string, Point>, key: string): number | undefined {
  return map.get(key)?.x;
}

function byNumber(map: Map<number, string>, key: number): string {
  return map.get(key) ?? "missing";
}

let total = 0;
const warm = new Map<string, number>([["a", 1]]);
for (let i = 0; i < 2000; i++) total += orZero(warm, "a") + orOne(warm, "a") + afterHas(warm, "a") + bump(warm, "b");
console.log("2000 honest rounds: " + total);

const map = new Map<string, number>([
  ["one", 1],
  ["zero", 0],
  ["minus zero", -0],
  ["nan", NaN],
  ["half", 0.5],
]);
for (const key of ["one", "zero", "minus zero", "nan", "half", "missing", "constructor", "__proto__", ""]) attempt(show(key), () => [typeof map.get(key), map.get(key), orZero(map, key), orOne(map, key), afterHas(map, key)]);

const blank = new Map<string, number | undefined>([["there", undefined]]);
attempt("present and undefined", () => [blank.has("there"), blank.get("there"), blank.get("there") ?? "fallback", blank.size]);

const points = new Map<string, Point>([["p", new Point(3)]]);
attempt("points", () => [xOf(points, "p"), xOf(points, "q"), typeof points.get("q")]);

const numbers = new Map<number, string>();
numbers.set(0, "zero");
numbers.set(1, "one");
numbers.set(NaN, "nan");
numbers.set(1.5, "one and a half");
numbers.set(2 ** 31, "large");
attempt("number keys", () => [0, -0, 1, 1.0, NaN, 0 / 0, 1.5, 3 / 2, 2 ** 31, 2147483647 + 1, -1, 2].map(key => byNumber(numbers, key)));
numbers.set(-0, "minus zero");
attempt("minus zero is stored as zero", () => [numbers.size, byNumber(numbers, 0), [...numbers.keys()].map(key => show(key))]);

const mixed = new Map<number | string, string>([
  [1, "a number"],
  ["1", "a string"],
]);
attempt("1 and '1' are two keys", () => [mixed.size, mixed.get(1), mixed.get("1"), mixed.get(1.0), mixed.get("1.0")]);

const byObject = new Map<Point, number>();
const key = new Point(1);
byObject.set(key, 5);
attempt("objects are keys by identity", () => [byObject.get(key), byObject.get(new Point(1)), (byObject.get(new Point(1)) ?? 0) + 1]);

attempt("counted", () => {
  const counts = new Map<string, number>();
  for (const word of ["a", "b", "a", "constructor", "a"]) bump(counts, word);
  return [...counts].map(([word, count]) => word + count);
});
attempt("deleted while it is walked", () => {
  const walked = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
  const seen: string[] = [];
  for (const [name, value] of walked) {
    seen.push(name + value + typeof walked.get("b"));
    walked.delete("b");
  }
  return seen;
});

export {};

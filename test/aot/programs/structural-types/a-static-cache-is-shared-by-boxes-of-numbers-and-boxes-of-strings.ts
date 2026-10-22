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

class Cached<T> {
  static cache = new Map();
  readonly make: (key: string) => T;
  constructor(make: (key: string) => T) {
    this.make = make;
  }
  get(key: string): T {
    if (!Cached.cache.has(key)) Cached.cache.set(key, this.make(key));
    return Cached.cache.get(key);
  }
}

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
  twice(): number {
    return this.x * 2;
  }
}

const lengths = new Cached<number>(key => key.length);
const halves = new Cached<number>(key => key.length / 2);
const shouts = new Cached<string>(key => key.toUpperCase());
const points = new Cached<Point>(key => new Point(key.length));
const thunks = new Cached<() => number>(key => () => key.length);

function plusOne(c: Cached<number>, key: string): number {
  return c.get(key) + 1;
}

function width(c: Cached<string>, key: string): number {
  return c.get(key).length;
}

function twice(c: Cached<Point>, key: string): number {
  return c.get(key).twice();
}

function run(c: Cached<() => number>, key: string): number {
  return c.get(key)();
}

let total = 0;
for (let i = 0; i < 2000; i++) total += plusOne(lengths, "n" + (i % 9)) + width(shouts, "s" + (i % 9)) + twice(points, "p" + (i % 9)) + run(thunks, "t" + (i % 9));
console.log("2000 honest rounds: " + total + ", entries " + Cached.cache.size);

function report(key: string): void {
  console.log("the entry " + key + ": " + typeof Cached.cache.get(key));
  attempt("  as a number + 1", () => plusOne(lengths, key));
  attempt("  as a number * 2", () => halves.get(key) * 2);
  attempt("  as a number, typeof", () => typeof lengths.get(key));
  attempt("  as a string, its length", () => width(shouts, key));
  attempt("  as a string, lower", () => shouts.get(key).toLowerCase());
  attempt("  as a point, twice", () => twice(points, key));
  attempt("  as a point, x", () => points.get(key).x);
  attempt("  as a function", () => run(thunks, key));
}

lengths.get("number first");
report("number first");
halves.get("odd");
report("odd");
shouts.get("string first");
report("string first");
points.get("point first");
report("point first");
thunks.get("function first");
report("function first");

export {};

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

interface Point {
  x: number;
  y: number;
  name: string;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function sumOf(p: Point): number {
  return p.x + p.y;
}

function widthOf(p: Point): number {
  return p.name.length;
}

function describe(p: Point): string {
  return typeof p.x + " " + show(p.x) + ", " + typeof p.y + " " + show(p.y) + ", " + typeof p.name + " " + show(p.name) + ", " + JSON.stringify(p);
}

const p: Point = { x: 0, y: 0.5, name: "p" };
const keys: ("x" | "name")[] = [];
const values: (number | string)[] = [];
for (let i = 0; i < 2000; i++) {
  keys.push(i % 2 === 0 ? "x" : "name");
  values.push(i % 2 === 0 ? i : "n" + i);
}
keys.push("x", "name", "x", "name");
values.push("late text", 77, 5, "fine");

let total = 0;
for (let i = 0; i < keys.length; i++) {
  set(p, keys[i], values[i]);
  if (i < 2000) {
    total += sumOf(p) + widthOf(p);
    continue;
  }
  console.log("round " + i + ": " + describe(p));
  attempt("  sum", () => sumOf(p));
  attempt("  width", () => widthOf(p));
  attempt("  x + 1", () => p.x + 1);
  attempt("  name.toUpperCase()", () => p.name.toUpperCase());
}
console.log("2000 honest rounds: " + total);
console.log("at the end: " + describe(p) + " " + sumOf(p) + " " + widthOf(p));

export {};

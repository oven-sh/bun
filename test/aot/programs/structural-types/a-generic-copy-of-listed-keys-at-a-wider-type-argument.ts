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
}

interface Loose {
  x: number | string;
  y: number | null;
}

function copyKeys<T>(target: T, source: T, keys: (keyof T)[]): void {
  for (const key of keys) target[key] = source[key];
}

function lengthOf(p: Point): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

function report(title: string, p: Point): void {
  console.log(title + ": " + typeof p.x + " " + show(p.x) + ", " + typeof p.y + " " + show(p.y) + ", " + JSON.stringify(p));
  attempt("  x + y", () => p.x + p.y);
  attempt("  x * y", () => p.x * p.y);
  attempt("  length", () => lengthOf(p));
  attempt("  y.toFixed(1)", () => p.y.toFixed(1));
}

const p: Point = { x: 3, y: 4 };
let total = 0;
for (let i = 0; i < 2000; i++) {
  copyKeys(p, { x: i, y: i / 2 }, ["x", "y"]);
  total += lengthOf(p);
}
console.log("2000 honest copies: " + Math.round(total));
report("honest", p);

const loose: Loose = { x: "three", y: null };
copyKeys<Loose>(p, loose, ["x"]);
report("x comes from a looser object", p);
copyKeys<Loose>(p, loose, ["y"]);
report("y too", p);
copyKeys(p, { x: 6, y: 8 }, ["x", "y"]);
report("honest again", p);
copyKeys<Loose>(p, loose, []);
report("no key at all", p);
copyKeys<Loose>(p, { x: 1.5, y: -0 }, ["y", "x"]);
report("looser by type and honest by value", p);

export {};

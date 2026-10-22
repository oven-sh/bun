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

function describe(p: Point): string {
  return typeof p.x + " " + show(p.x) + ", " + typeof p.y + " " + show(p.y) + ", " + typeof p.name + " " + show(p.name) + ", keys " + Object.keys(p).join() + ", " + JSON.stringify(p);
}

const yes: boolean = process.argv.length > 0;

const p: Point = { x: 1, y: 2.5, name: "p" };
console.log("before: " + describe(p));
set(p, yes ? "x" : "name", "text");
console.log("a string in the integer: " + describe(p));
attempt("x + 1", () => p.x + 1);
attempt("x - 1", () => p.x - 1);
attempt("x * 2", () => p.x * 2);
attempt("x | 0", () => p.x | 0);
attempt("x >>> 0", () => p.x >>> 0);
attempt("-x", () => -p.x);
attempt("x < 5", () => p.x < 5);
attempt("x === 1", () => p.x === 1);
attempt("x === x", () => p.x === p.x);
attempt("Math.floor(x)", () => Math.floor(p.x));
attempt("Number.isInteger(x)", () => Number.isInteger(p.x));
attempt("x.toFixed(1)", () => p.x.toFixed(1));
attempt("x.toString()", () => p.x.toString());
attempt("a template", () => `${p.x}`);
attempt("x + y", () => p.x + p.y);
attempt("an index", () => [10, 20, 30][p.x]);
attempt("x++", () => [p.x++, p.x]);
console.log("after x++: " + describe(p));

set(p, yes ? "y" : "name", "7");
console.log("a string in the fraction: " + describe(p));
attempt("y + 1", () => p.y + 1);
attempt("y * 2", () => p.y * 2);
attempt("y / 2", () => p.y / 2);
attempt("y | 0", () => p.y | 0);
attempt("y === 7", () => p.y === 7);
attempt("y < 10", () => p.y < 10);
attempt("y.toFixed(1)", () => p.y.toFixed(1));
attempt("Math.sqrt(y)", () => Math.sqrt(p.y));
attempt("y += 1", () => (p.y += 1));
console.log("after y += 1: " + describe(p));

set(p, "x", 4);
set(p, "y", 0.5);
console.log("honest again: " + describe(p) + " " + (p.x + p.y));

export {};

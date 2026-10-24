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
  name: string;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

const yes: boolean = process.argv.length > 0;

function spoil(p: Point): void {
  set(p, yes ? "x" : "name", "text");
  set(p, yes ? "name" : "x", 7);
}

function describe(p: Point): string {
  return typeof p.x + " " + show(p.x) + ", " + typeof p.name + " " + show(p.name) + ", " + JSON.stringify(p);
}

function twice(p: Point): number {
  return p.x * 2;
}

function shout(p: Point): string {
  return p.name.toUpperCase();
}

class Holder {
  point: Point = { x: 1, name: "held" };
  twice(): number {
    return this.point.x * 2;
  }
  shout(): string {
    return this.point.name.toUpperCase();
  }
}

function counter(): { read: () => number; shout: () => string; spoil: () => void; describe: () => string } {
  const captured: Point = { x: 1, name: "captured" };
  return { read: () => captured.x + 1, shout: () => captured.name.toUpperCase(), spoil: () => spoil(captured), describe: () => describe(captured) };
}

function made(): Point {
  const p: Point = { x: 1, name: "made" };
  spoil(p);
  return p;
}

const local: Point = { x: 1, name: "local" };
console.log("a local before: " + describe(local) + " " + twice(local) + " " + shout(local));
spoil(local);
console.log("a local: " + describe(local));
attempt("  x + 1", () => local.x + 1);
attempt("  twice", () => twice(local));
attempt("  shout", () => shout(local));

const holder = new Holder();
console.log("a field before: " + describe(holder.point) + " " + holder.twice() + " " + holder.shout());
spoil(holder.point);
console.log("a field: " + describe(holder.point) + " " + JSON.stringify(holder));
attempt("  x + 1", () => holder.point.x + 1);
attempt("  twice", () => holder.twice());
attempt("  shout", () => holder.shout());

const points: Point[] = [
  { x: 1, name: "zero" },
  { x: 2, name: "one" },
  { x: 3, name: "two" },
];
spoil(points[1]);
console.log("an element: " + points.map(describe).join(" | "));
attempt("  a sum", () => points.reduce((sum, p) => sum + p.x, 0));
attempt("  a sum by a loop", () => {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].x;
  return sum;
});
attempt("  names", () => points.map(p => p.name.length));
attempt("  shouts", () => points.map(shout));

const closure = counter();
console.log("a captured variable before: " + closure.describe() + " " + closure.read() + " " + closure.shout());
closure.spoil();
console.log("a captured variable: " + closure.describe());
attempt("  read", () => closure.read());
attempt("  shout", () => closure.shout());

const returned = made();
console.log("a result: " + describe(returned));
attempt("  x + 1", () => returned.x + 1);
attempt("  shout", () => shout(returned));

const table = new Map<string, Point>([["k", { x: 1, name: "mapped" }]]);
for (const p of table.values()) spoil(p);
for (const [key, p] of table) {
  console.log("a value of a map: " + key + " " + describe(p));
  attempt("  twice", () => twice(p));
}

export {};

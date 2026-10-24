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
  y: number;
  label: string;
  constructor(x: number, y: number, label: string) {
    this.x = x;
    this.y = y;
    this.label = label;
  }
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
  sum(): number {
    return this.x + this.y;
  }
  shout(): string {
    return this.label.toUpperCase() + "!";
  }
  width(): number {
    return this.label.length;
  }
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function describe(p: Point): string {
  return typeof p.x + " " + show(p.x) + ", " + typeof p.y + " " + show(p.y) + ", " + typeof p.label + " " + show(p.label) + ", keys " + Object.keys(p).join() + ", " + JSON.stringify(p) + ", " + (p instanceof Point);
}

function report(title: string, p: Point): void {
  console.log(title + ": " + describe(p));
  attempt("  norm", () => p.norm());
  attempt("  sum", () => p.sum());
  attempt("  shout", () => p.shout());
  attempt("  width", () => p.width());
}

const yes: boolean = process.argv.length > 0;

const p = new Point(3, 0.5, "p");
report("before", p);
set(p, yes ? "x" : "label", "three");
report("a string in x", p);
set(p, yes ? "y" : "label", "half");
report("a string in y too", p);
set(p, yes ? "label" : "x", 12);
report("a number in the label", p);
set(p, "x", 1);
set(p, "y", 2);
set(p, "label", "q");
report("honest again", p);
report("another instance was never touched", new Point(3, 0.5, "p"));

export {};

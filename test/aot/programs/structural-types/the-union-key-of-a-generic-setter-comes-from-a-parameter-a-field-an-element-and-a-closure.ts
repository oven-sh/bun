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

type Key = "x" | "name";

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function describe(p: Point): string {
  return typeof p.x + " " + show(p.x) + ", " + typeof p.name + " " + show(p.name) + ", " + JSON.stringify(p);
}

function report(title: string, p: Point): void {
  console.log(title + ": " + describe(p));
  attempt("  x + 1", () => p.x + 1);
  attempt("  x.toFixed(1)", () => p.x.toFixed(1));
  attempt("  name.length", () => p.name.length);
  attempt("  name.toUpperCase()", () => p.name.toUpperCase());
}

function fresh(): Point {
  return { x: 1, name: "p" };
}

function byParameter(p: Point, key: Key, value: number | string): void {
  set(p, key, value);
}

class Chooser {
  key: Key;
  constructor(key: Key) {
    this.key = key;
  }
  apply(p: Point, value: number | string): void {
    set(p, this.key, value);
  }
}

function closeOver(key: Key): (p: Point, value: number | string) => void {
  return (p, value) => set(p, key, value);
}

function result(first: boolean): Key {
  return first ? "x" : "name";
}

const a = fresh();
byParameter(a, "x", "by parameter");
report("the key is a parameter", a);

const b = fresh();
new Chooser("x").apply(b, "by field");
new Chooser("name").apply(b, 2);
report("the key is a field", b);

const c = fresh();
const list: Key[] = ["name", "x"];
set(c, list[1], "by element");
set(c, list[0], 3);
report("the key is an element", c);

const d = fresh();
closeOver("x")(d, "by closure");
closeOver("name")(d, 4.5);
report("the key is a captured variable", d);

const e = fresh();
set(e, result(true), "by result");
set(e, result(false), 5);
report("the key is a result", e);

const f = fresh();
let local: Key = "name";
if (process.argv.length > 0) local = "x";
set(f, local, "by local");
report("the key is a local that was stored to", f);

const g = fresh();
for (const key of list) set(g, key, key === "x" ? "by loop" : 6);
report("the key is a loop variable", g);

const h = fresh();
const { key: taken }: { key: Key } = JSON.parse('{"key":"x"}');
set(h, taken, "by parsed text");
report("the key was parsed", h);

const honest = fresh();
byParameter(honest, "x", 9);
new Chooser("name").apply(honest, "q");
closeOver("x")(honest, 10);
report("honest through the same functions", honest);

export {};

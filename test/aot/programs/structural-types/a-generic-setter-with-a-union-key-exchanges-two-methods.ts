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

class Gauge {
  level = 4;
  unit = "bar";
  size(): number {
    return this.level * 2;
  }
  label(): string {
    return this.unit.toUpperCase();
  }
  both(): string {
    return this.size() + 1 + this.label().toLowerCase();
  }
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function sizePlusOne(g: Gauge): number {
  return g.size() + 1;
}

function labelWidth(g: Gauge): number {
  return g.label().length;
}

const yes: boolean = process.argv.length > 0;

function report(title: string, g: Gauge): void {
  console.log(title + ": own keys " + Object.keys(g).join() + ", " + JSON.stringify(g));
  attempt("  size()", () => g.size());
  attempt("  typeof size()", () => typeof g.size());
  attempt("  size() + 1", () => sizePlusOne(g));
  attempt("  label()", () => g.label());
  attempt("  label().length", () => labelWidth(g));
  attempt("  both()", () => g.both());
}

let total = 0;
const warm = new Gauge();
for (let i = 0; i < 2000; i++) total += sizePlusOne(warm) + labelWidth(warm) + warm.both().length;
console.log("2000 honest rounds: " + total);

const g = new Gauge();
report("before", g);
set(g, yes ? "size" : "label", g.label);
report("size is label: an own member", g);
set(g, yes ? "label" : "size", Gauge.prototype.size);
report("label is size too", g);
report("another instance", warm);

const size = Gauge.prototype.size;
const label = Gauge.prototype.label;
set(Gauge.prototype, yes ? "size" : "label", label);
set(Gauge.prototype, yes ? "label" : "size", size);
report("exchanged on the prototype: an instance made before", warm);
report("exchanged on the prototype: a new instance", new Gauge());
report("the one with own members shows the originals' exchange twice", g);
set(Gauge.prototype, "size", size);
set(Gauge.prototype, "label", label);
report("put back", warm);

export {};

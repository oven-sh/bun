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

const log: string[] = [];

class Thermometer {
  private kelvin = 273.15;
  label = "outside";
  get celsius(): number {
    return this.kelvin - 273.15;
  }
  set celsius(value: number) {
    log.push("set " + typeof value);
    this.kelvin = value + 273.15;
  }
  get rounded(): number {
    return Math.round(this.kelvin);
  }
  raw(): unknown {
    return this.kelvin;
  }
}

class Name {
  private text = "none";
  size = 0;
  get value(): string {
    return this.text;
  }
  set value(next: string) {
    log.push("set " + typeof next);
    this.text = next.trim();
    this.size = next.length;
  }
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

const yes: boolean = process.argv.length > 0;

function report(title: string, t: Thermometer): void {
  console.log(title + ": " + typeof t.raw() + " " + show(t.raw()) + ", " + JSON.stringify(t) + ", " + log.join());
  log.length = 0;
  attempt("  celsius", () => t.celsius);
  attempt("  typeof celsius", () => typeof t.celsius);
  attempt("  rounded", () => t.rounded);
  attempt("  celsius + 1", () => t.celsius + 1);
}

const t = new Thermometer();
let total = 0;
for (let i = 0; i < 2000; i++) {
  set(t, "celsius", i);
  total += t.celsius + t.rounded;
}
log.length = 0;
console.log("2000 honest rounds: " + Math.round(total));
report("honest", t);

set(t, yes ? "celsius" : "label", "20");
report("the setter gets a string", t);
set(t, yes ? "celsius" : "label", "warm");
report("the setter gets a word", t);
set(t, "celsius", 1);
report("honest again", t);
attempt("a getter without a setter", () => set(t, yes ? "rounded" : "celsius", 5));
report("after that", t);

const name = new Name();
set(name, "value", " ann ");
console.log("a name: " + show(name.value) + " " + name.size + " " + log.join());
log.length = 0;
attempt("the setter of a string gets a number", () => set(name, yes ? "value" : "size", 12));
console.log("after that: " + show(name.value) + " " + show(name.size) + " " + log.join());

export {};

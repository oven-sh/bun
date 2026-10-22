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

function extend<T extends object, U extends object>(target: T, source: U): T & U {
  return Object.assign(target, source);
}

function extendByLoop<T extends object, U extends T>(target: T, source: U): void {
  for (const key in target) target[key] = source[key];
}

class Meter {
  value = 5;
  step = 0.5;
  unit = "m";
  next(): number {
    return this.value + this.step;
  }
  text(): string {
    return this.value + this.unit.toUpperCase();
  }
}

function report(title: string, m: Meter): void {
  console.log(title + ": " + typeof m.value + " " + show(m.value) + ", " + typeof m.step + " " + show(m.step) + ", " + typeof m.unit + " " + show(m.unit) + ", keys " + Object.keys(m).join() + ", " + JSON.stringify(m));
  attempt("  next", () => m.next());
  attempt("  text", () => m.text());
  attempt("  value * 2", () => m.value * 2);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const m = extend(new Meter(), { value: i, extra: i });
  total += m.next() + m.text().length + m.extra;
}
console.log("2000 honest rounds: " + total);

const a = new Meter();
const extended = extend(a, { value: "five" });
console.log("the same object: " + Object.is(a, extended));
report("a string over the value", a);

const b = new Meter();
extend(b, { step: null, unit: 7 });
report("null over the step and a number over the unit", b);

const c = new Meter();
extend(c, { next: 3, text: "no method" });
report("own members over both methods", c);

const d = new Meter();
extend(d, ["zero", "one"]);
report("a list as the source", d);

const e = new Meter();
extend(e, new String("ab"));
report("a string object as the source", e);

const f = new Meter();
extend(f, {
  get value(): string {
    return "from a getter";
  },
});
report("a getter as the source: its value is copied", f);

const g = new Meter();
class Finer extends Meter {
  declare value: 1 | 2;
  step = 0.25;
}
extendByLoop(g, new Finer());
report("a loop over the target's keys, the source is a subclass", g);
report("a fresh one", new Meter());

export {};

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

type Nullable<T> = { [K in keyof T]: T[K] | null };

function wipe<T extends object>(target: T): void {
  const view: Nullable<T> = target;
  for (const key in view) view[key] = null;
}

function wipeOne<T extends object>(target: T, key: keyof T): void {
  const view: Nullable<T> = target;
  view[key] = null;
}

class Sensor {
  reading = 20;
  drift = 0.125;
  place = "roof";
  history: number[] = [1, 2];
  alarm: () => string = () => "ring";
  warmer(): number {
    return this.reading + 1;
  }
  corrected(): number {
    return this.reading - this.drift;
  }
  where(): string {
    return this.place.toUpperCase();
  }
  count(): number {
    return this.history.length;
  }
}

function report(title: string, s: Sensor): void {
  console.log(title + ": " + typeof s.reading + " " + typeof s.drift + " " + typeof s.place + " " + typeof s.history + " " + typeof s.alarm + ", keys " + Object.keys(s).join() + ", " + JSON.stringify(s));
  attempt("  warmer", () => s.warmer());
  attempt("  corrected", () => s.corrected());
  attempt("  where", () => s.where());
  attempt("  count", () => s.count());
  attempt("  alarm", () => s.alarm());
  attempt("  reading === null", () => [s.reading === null, s.reading === 0, s.reading == undefined]);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const s = new Sensor();
  s.reading = i;
  total += s.warmer() + s.corrected() + s.where().length + s.count() + s.alarm().length;
}
console.log("2000 honest rounds: " + total);

const one = new Sensor();
report("before", one);
wipeOne(one, "reading");
report("the reading is null", one);
wipeOne(one, "drift");
report("the drift too", one);
wipeOne(one, "place");
report("the place too", one);
wipeOne(one, "history");
wipeOne(one, "alarm");
report("all five", one);

const all = new Sensor();
wipe(all);
report("wiped in one loop", all);

const method = new Sensor();
wipeOne(method, "warmer");
report("a method is wiped: an own null over it", method);
report("a fresh one", new Sensor());

const literal = { a: 1, b: "two", c: [3] };
wipe(literal);
attempt("a literal", () => [literal, typeof literal.a, literal.a + 1]);
attempt("a literal: a method of its string", () => literal.b.length);
const list = [1, 2, 3];
wipe(list);
attempt("a list of numbers", () => [list, list[0] + 1, list.length]);

export {};

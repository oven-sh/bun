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

type Arguments = [number, string];

function plain(count: number, name: string): string {
  return arguments.length + ": " + typeof count + " " + show(count) + ", " + typeof name + " " + show(name);
}

function used(count: number, name: string): string {
  return count + 1 + name.toUpperCase();
}

function withDefault(count: number, name: string = "default"): string {
  return arguments.length + ": " + show(count) + " " + name.toUpperCase();
}

function withRest(count: number, ...names: string[]): string {
  return count + 1 + " " + names.length + " " + names.map(name => name.toUpperCase()).join();
}

class Pair {
  count: number;
  name: string;
  constructor(count: number, name: string) {
    this.count = count;
    this.name = name;
  }
  text(): string {
    return this.count + 1 + this.name.toUpperCase();
  }
}

function forward(...all: Parameters<typeof used>): string {
  return used(...all);
}

function report(title: string, tuple: Arguments): void {
  console.log(title + ": " + show(tuple));
  attempt("  plain", () => plain(...tuple));
  attempt("  used", () => used(...tuple));
  attempt("  with a default", () => withDefault(...tuple));
  attempt("  with a rest parameter", () => withRest(...tuple));
  attempt("  constructed", () => JSON.stringify(new Pair(...tuple)));
  attempt("  constructed and used", () => new Pair(...tuple).text());
  attempt("  forwarded", () => forward(...tuple));
  attempt("  applied", () => used.apply(null, tuple));
  attempt("  Reflect.apply", () => Reflect.apply(used, null, tuple));
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const tuple: Arguments = [i, "n"];
  total += plain(...tuple).length + used(...tuple).length + withRest(...tuple).length + new Pair(...tuple).text().length + forward(...tuple).length;
}
console.log("2000 honest rounds: " + total);

const tuple: Arguments = [1, "a"];
report("before", tuple);
tuple.push("extra");
report("one more", tuple);
tuple.push(9);
report("a number where the rest parameter has strings", tuple);
tuple.length = 2;
tuple.pop();
report("one less", tuple);
tuple.pop();
report("none", tuple);
tuple.push("z", 26);
report("the other way around", tuple);

export {};

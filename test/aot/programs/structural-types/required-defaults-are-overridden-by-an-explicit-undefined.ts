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

interface Options {
  depth?: number;
  ratio?: number;
  name?: string;
  log?: (text: string) => number;
}

function withDefaults<T>(given: T, defaults: Required<T>): Required<T> {
  return { ...defaults, ...given };
}

const defaults: Required<Options> = { depth: 2, ratio: 0.5, name: "none", log: text => text.length };

function use(o: Required<Options>): string {
  return o.depth + 1 + " " + o.ratio * 2 + " " + o.name.toUpperCase() + " " + o.log("abc");
}

function report(title: string, o: Required<Options>): void {
  console.log(title + ": " + typeof o.depth + " " + show(o.depth) + ", " + typeof o.ratio + " " + show(o.ratio) + ", " + typeof o.name + " " + show(o.name) + ", " + typeof o.log + ", keys " + Object.keys(o).join() + ", " + JSON.stringify(o));
  attempt("  depth + 1", () => o.depth + 1);
  attempt("  ratio * 2", () => o.ratio * 2);
  attempt("  name.toUpperCase()", () => o.name.toUpperCase());
  attempt("  log('abc')", () => o.log("abc"));
  attempt("  all of them", () => use(o));
}

let width = 0;
for (let i = 0; i < 2000; i++) width += use(withDefaults<Options>(i % 2 === 0 ? { depth: i } : { name: "n" + i }, defaults)).length;
console.log("2000 honest rounds: " + width);

report("nothing given", withDefaults<Options>({}, defaults));
report("depth: undefined", withDefaults<Options>({ depth: undefined }, defaults));
report("ratio: undefined", withDefaults<Options>({ ratio: undefined }, defaults));
report("name: undefined", withDefaults<Options>({ name: undefined }, defaults));
report("log: undefined", withDefaults<Options>({ log: undefined }, defaults));
const wide = { depth: 1, name: "wide", ratio: 1, log: undefined, more: "more" };
report("a variable with one member more", withDefaults<Options>(wide, defaults));
report("the defaults were never touched", defaults);

export {};

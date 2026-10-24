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

function fill<V>(record: Record<string, V>, keys: string[], value: V): void {
  for (const key of keys) record[key] = value;
}

function drop<V>(record: Record<string, V>, keys: string[]): void {
  for (const key of keys) delete record[key];
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

function describe(o: object): string {
  return "keys " + Object.keys(o).join() + ", " + JSON.stringify(o) + ", prototype is Object.prototype: " + (Object.getPrototypeOf(o) === Object.prototype);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const p = { x: 0, y: 0 };
  fill(p, ["x", "y"], i);
  total += sum(p);
}
console.log("2000 honest rounds: " + total);

const a = { x: 1, y: 2 };
fill(a, ["y", "z", "w"], 7);
console.log("two new keys: " + describe(a) + " " + sum(a));

const b = { x: 1, y: 2 };
fill(b, ["1", "0", "-1", "01", "1.5", "x"], 8);
console.log("keys that look like numbers: " + describe(b) + " " + sum(b));

const c = { x: 1, y: 2 };
fill(c, ["__proto__", "constructor", "toString", "valueOf"], 9);
console.log("names that Object.prototype has: " + describe(c) + " " + sum(c));
attempt("  its constructor", () => typeof c.constructor);
attempt("  a template", () => `${c}`);
attempt("  its valueOf is called", () => typeof c.valueOf());

const parent = { x: 100, extra: 5 };
const d = { own: { x: 1 } };
fill<object>(d, ["__proto__"], parent);
console.log("an object under the name __proto__: keys " + Object.keys(d).join() + ", " + JSON.stringify(d) + ", the prototype is that object: " + (Object.getPrototypeOf(d) === parent));
attempt("  'extra' in it", () => "extra" in d);
attempt("  own.x", () => d.own.x + 1);
attempt("  for in", () => {
  const names: string[] = [];
  for (const name in d) names.push(name);
  return names;
});

const e = { x: 1, y: 2 };
drop(e, ["x"]);
console.log("a required key is dropped: " + describe(e) + " " + typeof e.x);
attempt("  sum", () => sum(e));
attempt("  x + 1", () => e.x + 1);
fill(e, ["x"], 3);
console.log("and filled again: " + describe(e) + " " + sum(e));

const f = { x: 1, y: 2 };
fill<number | string>(f, [], "never stored");
console.log("a wider type argument and no key: " + describe(f) + " " + sum(f));
const g: { x: number; y: number } = { x: 1, y: 2 };
const wider: Record<string, number | string> = g;
fill(wider, ["x"], "text");
console.log("a wider record: " + describe(g) + " " + typeof g.x);
attempt("  sum", () => sum(g));
attempt("  x.toFixed(0)", () => g.x.toFixed(0));

export {};

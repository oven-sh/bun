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

function byDestructuring<T, K extends keyof T>(target: T, a: K, b: K): void {
  [target[a], target[b]] = [target[b], target[a]];
}

function byObjectPattern<T, K extends keyof T>(target: T, key: K, source: { value: T[K] }): void {
  ({ value: target[key] } = source);
}

function byDefault<T, K extends keyof T>(target: T, key: K, fallback: T[K]): void {
  [target[key] = fallback] = [];
}

function byForOf<T, K extends keyof T>(target: T, key: K, values: T[K][]): void {
  for (target[key] of values);
}

function byNullish<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] ??= value;
}

function byOr<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] ||= value;
}

function byAnd<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] &&= value;
}

function byRest<T, K extends keyof T>(target: T, key: K, ...values: T[K][]): void {
  [, target[key]] = values;
}

function byChain<T, K extends keyof T>(first: T, second: T, key: K, value: T[K]): void {
  first[key] = second[key] = value;
}

function byComma<T, K extends keyof T>(target: T, key: K, value: T[K]): T[K] {
  return (target[key] = value), target[key];
}

const yes: boolean = process.argv.length > 0;
const x: Key = yes ? "x" : "name";
const name: Key = yes ? "name" : "x";

function fresh(): Point {
  return { x: 1, name: "p" };
}

function report(title: string, p: Point): void {
  console.log(title + ": " + typeof p.x + " " + show(p.x) + ", " + typeof p.name + " " + show(p.name) + ", " + JSON.stringify(p));
  attempt("  x + 1", () => p.x + 1);
  attempt("  name.length", () => p.name.length);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const p = fresh();
  byObjectPattern(p, "x", { value: i });
  byForOf(p, "x", [i, i + 1]);
  byNullish(p, "x", 5);
  byAnd(p, "name", "q");
  byRest(p, "x", 1, p.x + 1);
  total += p.x + p.name.length + byComma(p, "x", 2);
}
console.log("2000 honest rounds: " + total);

const a = fresh();
byDestructuring(a, x, name);
report("exchanged by a list pattern", a);
const b = fresh();
byObjectPattern(b, x, { value: "from an object pattern" });
report("an object pattern", b);
const c = fresh();
byDefault(c, x, "the default of a pattern");
report("the default of a pattern", c);
const d = fresh();
byForOf(d, x, [5, "the target of for of"]);
report("the target of for of", d);
const e = fresh();
byNullish(e, x, "not stored: x is there");
report("??= with x there", e);
const view: Partial<Point> = e;
view.x = undefined;
byNullish(e, x, "stored: x was undefined");
report("??= with x undefined", e);
const f: Point = { x: 0, name: "" };
byOr(f, x, "stored: x was zero");
byOr(f, name, 7);
report("||= with falsy members", f);
const g = fresh();
byAnd(g, x, "stored: x was truthy");
byAnd(g, name, 8);
report("&&= with truthy members", g);
const h = fresh();
byRest(h, x, 1, "the second of the rest");
report("a pattern over a rest parameter", h);
const i = fresh();
const j = fresh();
byChain(i, j, x, "chained");
report("a chain of stores: the first", i);
report("a chain of stores: the second", j);
const k = fresh();
attempt("a store and a read in one expression", () => byComma(k, x, "comma"));
report("after it", k);

export {};

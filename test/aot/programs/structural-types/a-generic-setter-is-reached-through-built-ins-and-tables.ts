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

function fresh(): Point {
  return { x: 1, name: "p" };
}

function report(title: string, p: Point): void {
  console.log(title + ": " + typeof p.x + " " + show(p.x) + ", " + typeof p.name + " " + show(p.name) + ", " + JSON.stringify(p));
  attempt("  x + 1", () => p.x + 1);
  attempt("  x.toFixed(0)", () => p.x.toFixed(0));
  attempt("  name.toUpperCase()", () => p.name.toUpperCase());
}

const setPoint = set<Point, Key>;
const table: ((target: Point, key: Key, value: number | string) => void)[] = [setPoint];
const holder = { write: setPoint };

let total = 0;
for (let i = 0; i < 2000; i++) {
  const p = fresh();
  setPoint(p, "x", i);
  table[0](p, "name", "n" + i);
  holder.write(p, "x", p.x + 1);
  total += p.x + p.name.length;
}
console.log("2000 honest rounds: " + total);

const a = fresh();
setPoint(a, "x", "at one type argument");
report("kept at one type argument", a);

const b = fresh();
table[0](b, "x", "from a table");
report("from a table", b);

const c = fresh();
holder.write(c, "x", "from a field");
report("from a field", c);

const d = fresh();
const keys: Key[] = ["x", "name"];
keys.forEach(key => set(d, key, key === "x" ? "in forEach" : 4));
report("inside forEach", d);

const e = fresh();
Reflect.apply(set, undefined, [e, "x", "by Reflect.apply"]);
report("by Reflect.apply", e);

const f = fresh();
setPoint.call(undefined, f, "x", "by call");
setPoint.apply(undefined, [f, "name", 6]);
report("by call and apply", f);

const g = fresh();
const bound = setPoint.bind(undefined, g);
bound("x", "by a bound function");
report("by a bound function", g);

const h = fresh();
new Map<Key, number | string>([
  ["x", "from a map"],
  ["name", 8],
]).forEach((value, key) => set(h, key, value));
report("inside a map's forEach", h);

const i = fresh();
"x".replace(/x/, found => {
  const key: Key = found === "x" ? "x" : "name";
  set(i, key, "in a replacer");
  return found;
});
report("inside a replacer", i);

const j = fresh();
await Promise.resolve<Key>("x").then(key => set(j, key, "in a reaction"));
report("inside a promise's reaction", j);

const k = fresh();
[3, 1, 2].toSorted((left, right) => {
  set(k, left > right ? "x" : "name", left > right ? "in a comparator" : 9);
  return left - right;
});
console.log("inside a comparator: " + typeof k.x + " " + typeof k.name);

export {};

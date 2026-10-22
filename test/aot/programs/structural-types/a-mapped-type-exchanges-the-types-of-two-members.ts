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
  live: boolean;
}

type Exchanged<T extends { x: unknown; name: unknown }> = { [K in keyof T as K extends "x" ? "name" : K extends "name" ? "x" : K]: T[K] };
type Prefixed<T> = { [K in keyof T as `old${Capitalize<K & string>}`]: T[K] };
type Getters<T> = { [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K] };

function xOf<T extends { x: unknown }>(o: T): T["x"] {
  return o.x;
}

function nameOf<T extends { name: unknown }>(o: T): T["name"] {
  return o.name;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

const yes: boolean = process.argv.length > 0;

const point: Point = { x: 1, name: "p", live: true };
const exchanged: Exchanged<Point> = { name: 2, x: "q", live: false };
const sameOrder: Exchanged<Point> = { x: "r", name: 3, live: true };
const prefixed: Prefixed<Point> = { oldX: 4, oldName: "s", oldLive: true };
const getters: Getters<Point> = { getX: () => 5, getName: () => "t", getLive: () => false };

let total = 0;
for (let i = 0; i < 2000; i++) total += xOf(point) + nameOf(point).length;
console.log("2000 rounds with the first shape: " + total);

attempt("the first shape", () => [xOf(point) + 1, nameOf(point).toUpperCase(), Object.keys(point), JSON.stringify(point)]);
attempt("the exchanged shape", () => [xOf(exchanged).toUpperCase(), nameOf(exchanged) + 1, Object.keys(exchanged), JSON.stringify(exchanged)]);
attempt("the exchanged shape in the first one's order", () => [xOf(sameOrder).toUpperCase(), nameOf(sameOrder) + 1, Object.keys(sameOrder), JSON.stringify(sameOrder)]);
attempt("the first shape again", () => [xOf(point) + 1, nameOf(point).toUpperCase()]);
attempt("in one list", () => [point, exchanged, sameOrder].map(o => typeof o.x + " " + typeof o.name + " " + String(o.x) + String(o.name)));
attempt("prefixed", () => [prefixed.oldX + 1, prefixed.oldName.toUpperCase(), prefixed.oldLive, Object.keys(prefixed)]);
attempt("getters", () => [getters.getX() + 1, getters.getName().toUpperCase(), getters.getLive(), Object.keys(getters)]);

set(exchanged, yes ? "x" : "name", 9);
attempt("a union key on the exchanged shape: a number in its x", () => [typeof exchanged.x, JSON.stringify(exchanged), exchanged.x + "!"]);
attempt("a union key on the exchanged shape: a method", () => exchanged.x.toUpperCase());
set(prefixed, yes ? "oldX" : "oldName", "text");
attempt("a union key on the prefixed shape", () => [typeof prefixed.oldX, prefixed.oldX + 1, JSON.stringify(prefixed)]);
set(getters, yes ? "getX" : "getName", () => "from the other getter");
attempt("a union key on the getters", () => [typeof getters.getX(), getters.getX() + 1]);
attempt("a union key on the getters: a method of the result", () => getters.getX().toFixed(1));

export {};

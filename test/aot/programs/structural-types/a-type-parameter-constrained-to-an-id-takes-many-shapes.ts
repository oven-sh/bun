function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function idOf<T extends { id: number }>(x: T): number {
  return x.id;
}

function nextId<T extends { id: number }>(x: T): number {
  return x.id + 1;
}

function same<T extends { id: number }>(x: T): T {
  return x;
}

function sumIds<T extends { id: number }>(list: T[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i].id;
  return sum;
}

function bump<T extends { id: number }>(x: T): T {
  x.id += 1;
  return x;
}

function keysOf<T extends { id: number }>(x: T): string {
  return Object.keys(x).join();
}

function copyOf<T extends { id: number }>(x: T): T {
  return { ...x };
}

class Row {
  id = 10;
  name = "row";
}

class Wide extends Row {
  a = 1;
  b = 2;
  c = 3;
}

class Computed {
  #n = 20;
  get id(): number {
    log.push("get-id");
    return this.#n;
  }
  set id(value: number) {
    log.push("set-id");
    this.#n = value;
  }
}

class OnPrototype {
  declare id: number;
}
Object.defineProperty(OnPrototype.prototype, "id", { value: 30, writable: true, configurable: true });

const makers: [string, () => { id: number }][] = [
  ["only an id", () => ({ id: 1 })],
  ["id first", () => ({ id: 2, a: "a", b: "b" })],
  ["id last", () => ({ a: "a", b: "b", id: 3 })],
  ["id in the middle", () => ({ a: "a", id: 4, b: "b" })],
  ["a fraction", () => ({ id: 1.5 })],
  ["negative zero", () => ({ id: -0 })],
  ["not a number", () => ({ id: NaN })],
  ["beyond 32 bits", () => ({ id: 2147483647 })],
  ["a class", () => new Row()],
  ["a subclass", () => new Wide()],
  ["accessors of a class", () => new Computed()],
  ["a member of the prototype", () => new OnPrototype()],
  ["a getter of a literal", () => ({ get id() { log.push("get-id"); return 40; }, set id(v: number) { log.push("set-id:" + v); } })],
  ["an array with an id", () => Object.assign([1, 2], { id: 50 })],
  ["a function with an id", () => Object.assign(() => 1, { id: 60 })],
  ["a map with an id", () => Object.assign(new Map<string, number>(), { id: 70 })],
  ["inherited through Object.create", () => { const made: { id: number } = Object.create({ id: 80 }); return made; }],
  ["frozen", () => Object.freeze({ id: 90 })],
  ["twenty members", () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, id: 100, k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18, s: 19 })],
  ["numeric keys too", () => ({ 1: "one", id: 110, 0: "zero" })],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += idOf({ id: i }) + nextId({ id: i }) + same({ id: i }).id + sumIds([{ id: i }]) + bump({ id: i }).id;
console.log("2000 honest rounds with one shape", warm);

for (const [name, make] of makers) {
  attempt(name + ": idOf", () => idOf(make()));
  attempt(name + ": nextId", () => nextId(make()));
  attempt(name + ": same", () => same(make()).id);
  attempt(name + ": bump", () => bump(make()).id);
  attempt(name + ": keysOf", () => keysOf(make()));
  attempt(name + ": copyOf", () => JSON.stringify(copyOf(make())));
}

attempt("all in one list", () => sumIds(makers.map(([, make]) => make())));
attempt("called with the shapes known", () => [idOf({ id: 2, a: "a" }), idOf({ a: "a", id: 3 }), idOf(new Row()), idOf(new Wide()), idOf(new Computed()), same({ id: 5, extra: "kept" }).extra, same(new Wide()).c, copyOf({ id: 1, z: 2 }).z]);

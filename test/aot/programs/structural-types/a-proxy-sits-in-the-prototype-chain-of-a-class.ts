function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

class Vec {
  x: number;
  y: number;
  name = "vec";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  get sum(): number {
    return this.x + this.y;
  }
  set sum(value: number) {
    this.x = value;
    this.y = 0;
  }
}

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

class Base {
  kind = "base";
  helper?(): number;
  describe(): string {
    return this.kind;
  }
}

class Derived extends Base {
  size = 2;
  twice(): number {
    return this.size * 2;
  }
  helped(): number {
    return this.helper?.() ?? -1;
  }
}

function twice(value: Derived): number {
  return value.twice();
}

function describe(value: Derived): string {
  return value.describe();
}

function helped(value: Derived): number {
  return value.helped();
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Derived();
  warm += twice(honest) + describe(honest).length + helped(honest);
}
console.log("before the proxy is put in", warm);

const old = new Derived();
const above = Object.getPrototypeOf(Base.prototype);
Object.setPrototypeOf(
  Base.prototype,
  new Proxy(above, {
    get(target, key, receiver) {
      log.push("get:" + String(key));
      if (key === "helper") return () => 77;
      return Reflect.get(target, key, receiver);
    },
    has: (target, key) => (log.push("has:" + String(key)), Reflect.has(target, key)),
    set: (target, key, value, receiver) => (log.push("set:" + String(key)), Reflect.set(target, key, value, receiver)),
  }),
);

for (const [name, make] of [["an old instance", () => old], ["a new instance", () => new Derived()]] satisfies [string, () => Derived][]) {
  logged(name + ": its own method", () => twice(make()));
  logged(name + ": an inherited method", () => describe(make()));
  logged(name + ": an optional method that only the proxy has", () => helped(make()));
  logged(name + ": fields", () => [make().size, make().kind]);
  logged(name + ": in", () => ["size" in make(), "helper" in make(), "nothing" in make()]);
  logged(name + ": toString", () => String(make()));
  logged(name + ": hasOwnProperty", () => make().hasOwnProperty("size"));
  logged(name + ": instanceof", () => [make() instanceof Derived, make() instanceof Base, make() instanceof Object]);
  logged(name + ": keys and JSON", () => [Object.keys(make()), JSON.stringify(make())]);
  logged(name + ": a store to a field", () => {
    const value = make();
    value.size = 5;
    return value.twice();
  });
}
logged("construction", () => new Derived().size);
Object.setPrototypeOf(Base.prototype, above);
logged("after the proxy is taken out", () => [twice(new Derived()), describe(old), helped(old)]);

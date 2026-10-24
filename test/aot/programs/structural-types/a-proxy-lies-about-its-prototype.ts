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

class Other {
  z = 9;
  depth(): number {
    return this.z * 2;
  }
}

function isVec(value: Vec | Other): boolean {
  return value instanceof Vec;
}

function measure(value: Vec | Other): number {
  return value instanceof Vec ? value.x + value.y : value.z;
}

function call(value: Vec | Other): number {
  return value instanceof Other ? value.depth() : value.norm();
}

function prototypeIs(value: object): string {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Vec.prototype ? "Vec" : prototype === Other.prototype ? "Other" : prototype === null ? "null" : "something else";
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += (isVec(new Vec(i, 1)) ? 1 : 0) + (isVec(new Other()) ? 1 : 0) + measure(new Vec(i, 1)) + measure(new Other()) + call(new Vec(3, 4)) + call(new Other()) + prototypeIs(new Vec(1, 1)).length;
console.log("after 2000 honest values", warm);

function claiming(target: Vec, prototype: object | null): Vec {
  return new Proxy(target, { getPrototypeOf: () => (log.push("getPrototypeOf"), prototype) });
}

const cases: [string, () => Vec | Other][] = [
  ["a vector", () => new Vec(3, 4)],
  ["a vector that claims to be a vector", () => claiming(new Vec(3, 4), Vec.prototype)],
  ["a vector that claims to be the other", () => claiming(new Vec(3, 4), Other.prototype)],
  ["a vector that claims to have no prototype", () => claiming(new Vec(3, 4), null)],
  ["a vector that claims a plain prototype", () => claiming(new Vec(3, 4), Object.prototype)],
  ["the other that claims to be a vector", () => new Proxy(new Other(), { getPrototypeOf: () => (log.push("getPrototypeOf"), Vec.prototype) })],
  ["a proxy without traps", () => new Proxy(new Vec(3, 4), {})],
];
for (const [name, make] of cases) {
  logged(name + ": instanceof Vec", () => isVec(make()));
  logged(name + ": measured", () => measure(make()));
  logged(name + ": called", () => call(make()));
  logged(name + ": its prototype", () => prototypeIs(make()));
  logged(name + ": isPrototypeOf", () => [Vec.prototype.isPrototypeOf(make()), Other.prototype.isPrototypeOf(make())]);
}
logged("a lie about an object that cannot be extended", () => isVec(claiming(Object.preventExtensions(new Vec(3, 4)), Other.prototype)));
logged("a trap that throws", () => isVec(new Proxy(new Vec(3, 4), { getPrototypeOf: () => { throw new RangeError("no"); } })));
logged("a child of a lying proxy", () => {
  const child: Vec = Object.create(claiming(new Vec(3, 4), Other.prototype));
  return [isVec(child), child instanceof Other, child.x];
});
logged("setPrototypeOf is refused", () => Object.setPrototypeOf(new Proxy(new Vec(3, 4), { setPrototypeOf: () => (log.push("setPrototypeOf"), false) }), null));
logged("Reflect.setPrototypeOf is refused", () => Reflect.setPrototypeOf(new Proxy(new Vec(3, 4), { setPrototypeOf: () => (log.push("setPrototypeOf"), false) }), null));

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

function layer(name: string, target: Vec): Vec {
  return new Proxy(target, {
    get: (inner, key, receiver) => (log.push(name + ".get:" + String(key)), Reflect.get(inner, key, receiver)),
    set: (inner, key, value, receiver) => (log.push(name + ".set:" + String(key)), Reflect.set(inner, key, value, receiver)),
    has: (inner, key) => (log.push(name + ".has:" + String(key)), Reflect.has(inner, key)),
    defineProperty: (inner, key, descriptor) => (log.push(name + ".define:" + String(key)), Reflect.defineProperty(inner, key, descriptor)),
    getOwnPropertyDescriptor: (inner, key) => (log.push(name + ".describe:" + String(key)), Reflect.getOwnPropertyDescriptor(inner, key)),
    ownKeys: inner => (log.push(name + ".ownKeys"), Reflect.ownKeys(inner)),
    getPrototypeOf: inner => (log.push(name + ".getPrototypeOf"), Reflect.getPrototypeOf(inner)),
    deleteProperty: (inner, key) => (log.push(name + ".delete:" + String(key)), Reflect.deleteProperty(inner, key)),
  });
}

function twice(): Vec {
  return layer("outer", layer("inner", new Vec(3, 4)));
}

const uses: [string, (v: Vec) => unknown][] = [
  ["x + y", v => v.x + v.y],
  ["x = 9", v => (v.x = 9)],
  ["x++", v => v.x++],
  ["norm()", v => v.norm()],
  ["the getter", v => v.sum],
  ["the setter", v => {
    v.sum = 7;
    return [v.x, v.y];
  }],
  ["in", v => "x" in v],
  ["instanceof", v => v instanceof Vec],
  ["keys", v => Object.keys(v)],
  ["delete", v => Reflect.deleteProperty(v, "name")],
  ["JSON", v => JSON.stringify(v)],
];
for (const [, use] of uses) for (let i = 0; i < 500; i++) use(new Vec(3, 4));
console.log("after 500 honest vectors at every use");

for (const [name, use] of uses) logged(name, () => use(twice()));
logged("ten layers", () => {
  let v = new Vec(3, 4);
  for (let depth = 0; depth < 10; depth++) v = new Proxy(v, { get: (inner, key, receiver) => (log.push(String(depth)), Reflect.get(inner, key, receiver)) });
  return v.x;
});
logged("the inner layer is revoked", () => {
  const inner = Proxy.revocable(new Vec(3, 4), {});
  const outer = layer("outer", inner.proxy);
  const before = outer.x;
  inner.revoke();
  return [before, outer.x];
});

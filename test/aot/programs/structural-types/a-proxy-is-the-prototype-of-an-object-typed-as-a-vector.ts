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

function watched(target: Vec): Vec {
  return new Proxy(target, {
    get: (inner, key, receiver) => (log.push("get:" + String(key)), Reflect.get(inner, key, receiver)),
    set: (inner, key, value, receiver) => (log.push("set:" + String(key)), Reflect.set(inner, key, value, receiver)),
    has: (inner, key) => (log.push("has:" + String(key)), Reflect.has(inner, key)),
    getPrototypeOf: inner => (log.push("getPrototypeOf"), Reflect.getPrototypeOf(inner)),
  });
}

function child(): Vec {
  return Object.create(watched(new Vec(3, 4)));
}

function childWithX(): Vec {
  return Object.create(watched(new Vec(3, 4)), { x: { value: 30, writable: true, enumerable: true, configurable: true } });
}

function reparented(): Vec {
  return Object.setPrototypeOf(new Vec(1, 2), watched(new Vec(3, 4)));
}

const uses: [string, (v: Vec) => unknown][] = [
  ["x + y", v => v.x + v.y],
  ["name", v => v.name],
  ["norm()", v => v.norm()],
  ["the getter", v => v.sum],
  ["x = 9", v => {
    v.x = 9;
    return [v.x, Object.keys(v)];
  }],
  ["y++", v => {
    v.y++;
    return [v.y, Object.keys(v)];
  }],
  ["the setter", v => {
    v.sum = 7;
    return [v.x, v.y, Object.keys(v)];
  }],
  ["in", v => ["x" in v, "missing" in v]],
  ["own", v => [Object.hasOwn(v, "x"), Object.hasOwn(v, "y")]],
  ["instanceof", v => v instanceof Vec],
  ["keys", v => Object.keys(v)],
  ["for-in", v => {
    const names: string[] = [];
    for (const name in v) names.push(name);
    return names;
  }],
  ["JSON", v => JSON.stringify(v)],
];
for (const [, use] of uses) for (let i = 0; i < 500; i++) use(new Vec(3, 4));
console.log("after 500 honest vectors at every use");

for (const [name, make] of [["an empty child", child], ["a child with its own x", childWithX], ["a vector with a new prototype", reparented]] satisfies [string, () => Vec][]) {
  for (const [use, run] of uses) logged(name + ": " + use, () => run(make()));
}
logged("a prototype that swallows stores", () => {
  const swallowing: Vec = Object.create(new Proxy(new Vec(3, 4), { set: (_, key) => (log.push("set:" + String(key)), true) }));
  swallowing.x = 9;
  return [swallowing.x, Object.keys(swallowing)];
});
logged("a prototype that refuses stores", () => {
  const refusing: Vec = Object.create(new Proxy(new Vec(3, 4), { set: () => false }));
  refusing.x = 9;
  return refusing.x;
});

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

function setX(v: Vec, value: number): number {
  v.x = value;
  return v.x;
}

function increment(v: Vec): number {
  v.x++;
  return v.x;
}

function addY(v: Vec): number {
  v.x += v.y;
  return v.x;
}

function valueOfTheStore(v: Vec): number {
  return (v.x = 9);
}

function both(v: Vec): number[] {
  v.x = v.y = 8;
  return [v.x, v.y];
}

function byPattern(v: Vec): number[] {
  [v.x, v.y] = [v.y, v.x];
  return [v.x, v.y];
}

function byAssign(v: Vec): number[] {
  Object.assign(v, { x: 5, y: 6 });
  return [v.x, v.y];
}

function bySetter(v: Vec): number[] {
  v.sum = 7;
  return [v.x, v.y];
}

function rename(v: Vec): string {
  v.name += "!";
  return v.name;
}

const uses: [string, (v: Vec) => unknown][] = [
  ["x = 9", v => setX(v, 9)],
  ["x++", increment],
  ["x += y", addY],
  ["the value of the store", valueOfTheStore],
  ["x = y = 8", both],
  ["a swap by a pattern", byPattern],
  ["Object.assign", byAssign],
  ["the setter", bySetter],
  ["name += !", rename],
];

for (const [, use] of uses) for (let i = 0; i < 500; i++) use(new Vec(3, 4));
console.log("after 500 honest vectors at every use");

class Refused extends Error {}

const handlers: [string, ProxyHandler<Vec>][] = [
  ["forwards", { set: (target, key, value, receiver) => (log.push("set:" + String(key) + "=" + String(value)), Reflect.set(target, key, value, receiver)) }],
  ["answers false", { set: (_, key) => (log.push("set:" + String(key)), false) }],
  ["answers true and stores nothing", { set: (_, key) => (log.push("set:" + String(key)), true) }],
  ["stores the double", { set: (target, key, value) => Reflect.set(target, key, typeof value === "number" ? value * 2 : value) }],
  ["stores a string", { set: (target, key, value) => Reflect.set(target, key, String(value)) }],
  ["stores under another name", { set: (target, key, value) => Reflect.set(target, "other_" + String(key), value) }],
  ["throws", { set: () => { throw new Refused("no"); } }],
  ["deletes what is stored to", { set: (target, key) => Reflect.deleteProperty(target, key) }],
  ["defines a getter instead", { set: (target, key, value) => Reflect.defineProperty(target, key, { get: () => (log.push("getter"), value), configurable: true, enumerable: true }) }],
];
for (const [name, handler] of handlers) {
  for (const [use, run] of uses) {
    const target = new Vec(3, 4);
    logged(name + ": " + use, () => run(new Proxy(target, handler)));
    console.log("  target: " + show(target));
  }
}

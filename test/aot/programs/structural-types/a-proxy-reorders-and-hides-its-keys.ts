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

function keys(v: Vec): string[] {
  return Object.keys(v);
}

function names(v: Vec): string[] {
  const seen: string[] = [];
  for (const name in v) seen.push(name);
  return seen;
}

const uses: [string, (v: Vec) => unknown][] = [
  ["Object.keys", keys],
  ["for-in", names],
  ["Object.values", v => Object.values(v)],
  ["Object.entries", v => Object.entries(v).map(([key, value]) => key + "=" + String(value))],
  ["JSON", v => JSON.stringify(v)],
  ["spread", v => ({ ...v })],
  ["rest", v => {
    const { x, ...others } = v;
    return [x, others];
  }],
  ["Object.assign", v => Object.assign({}, v)],
  ["getOwnPropertyNames", v => Object.getOwnPropertyNames(v)],
  ["Reflect.ownKeys", v => Reflect.ownKeys(v).map(String)],
  ["x + y still works", v => v.x + v.y],
];

for (const [, use] of uses) for (let i = 0; i < 300; i++) use(new Vec(3, 4));
console.log("after 300 honest vectors at every use");

const handlers: [string, ProxyHandler<Vec>][] = [
  ["logs", {
    ownKeys: target => (log.push("ownKeys"), Reflect.ownKeys(target)),
    getOwnPropertyDescriptor: (target, key) => (log.push("describe:" + String(key)), Reflect.getOwnPropertyDescriptor(target, key)),
    get: (target, key, receiver) => (log.push("get:" + String(key)), Reflect.get(target, key, receiver)),
  }],
  ["reverses", { ownKeys: target => Reflect.ownKeys(target).reverse() }],
  ["hides x", { ownKeys: target => Reflect.ownKeys(target).filter(key => key !== "x") }],
  ["shows nothing", { ownKeys: () => [] }],
  ["invents a key", { ownKeys: target => [...Reflect.ownKeys(target), "ghost"] }],
  ["invents a key and describes it", {
    ownKeys: target => [...Reflect.ownKeys(target), "ghost"],
    getOwnPropertyDescriptor: (target, key) => (key === "ghost" ? { value: "boo", enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(target, key)),
  }],
  ["repeats a key", { ownKeys: () => ["x", "x"] }],
  ["answers with a number", { ownKeys: () => [1, 2].map(Object) }],
  ["says that nothing is enumerable", { getOwnPropertyDescriptor: (target, key) => ({ ...Reflect.getOwnPropertyDescriptor(target, key), enumerable: false }) }],
  ["says that nothing is there", { getOwnPropertyDescriptor: () => undefined }],
];
for (const [name, handler] of handlers) for (const [use, run] of uses) logged(name + ": " + use, () => run(new Proxy(new Vec(3, 4), handler)));
logged("hiding a key of a sealed vector", () => keys(new Proxy(Object.seal(new Vec(3, 4)), { ownKeys: () => ["y"] })));

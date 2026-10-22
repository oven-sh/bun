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

class Stop extends Error {}

function throwingAt(of: string, kind: "get" | "set"): Vec {
  return new Proxy(new Vec(3, 4), {
    get(target, key, receiver) {
      log.push("get:" + String(key));
      if (kind === "get" && key === of) throw new Stop(of);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set:" + String(key));
      if (kind === "set" && key === of) throw new Stop(of);
      return Reflect.set(target, key, value, receiver);
    },
  });
}

const effects: string[] = [];
function effect(name: string): number {
  effects.push(name);
  return 1;
}

const uses: [string, (v: Vec) => unknown][] = [
  ["x + y", v => v.x + v.y],
  ["effect + x + effect + y + effect", v => effect("a") + v.x + effect("b") + v.y + effect("c")],
  ["arguments", v => Math.max(effect("a"), v.x, effect("b"), v.y, effect("c"))],
  ["an object literal", v => ({ a: effect("a"), x: v.x, b: effect("b"), y: v.y })],
  ["x = effect", v => (v.x = effect("a"))],
  ["x = y = effect", v => (v.x = v.y = effect("a"))],
  ["x += effect", v => (v.x += effect("a"))],
  ["a swap", v => ([v.x, v.y] = [v.y, v.x])],
  ["norm()", v => v.norm()],
  ["the setter", v => (v.sum = effect("a"))],
  ["try and finally", v => {
    try {
      return v.x + v.y;
    } finally {
      effect("finally");
    }
  }],
  ["caught and read again", v => {
    try {
      return v.y;
    } catch {
      return v.x;
    }
  }],
  ["JSON", v => JSON.stringify(v)],
  ["spread", v => ({ ...v })],
];
for (const [, use] of uses) for (let i = 0; i < 300; i++) use(new Vec(3, 4));
console.log("after 300 honest vectors at every use");

for (const [of, kind] of [["x", "get"], ["y", "get"], ["x", "set"], ["y", "set"]] satisfies [string, "get" | "set"][]) {
  for (const [name, use] of uses) {
    effects.length = 0;
    logged(kind + " of " + of + " throws: " + name, () => use(throwingAt(of, kind)));
    console.log("  effects: " + effects.join(" "));
  }
}

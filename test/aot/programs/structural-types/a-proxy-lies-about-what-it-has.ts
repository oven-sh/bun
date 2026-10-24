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

interface Circle {
  radius: number;
}

interface Square {
  side: number;
}

function size(shape: Circle | Square): number {
  return "radius" in shape ? shape.radius * 2 : shape.side;
}

function hasX(v: Vec): boolean {
  return "x" in v;
}

function hasNorm(v: Vec): boolean {
  return "norm" in v;
}

function readIfThere(v: Vec): number {
  return "x" in v ? v.x : -1;
}

function reflected(v: Vec): boolean[] {
  return [Reflect.has(v, "x"), Object.hasOwn(v, "x"), v.hasOwnProperty("x"), v.x !== undefined];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += size({ radius: i }) + size({ side: i }) + (hasX(new Vec(i, 1)) ? 1 : 0) + (hasNorm(new Vec(i, 1)) ? 1 : 0) + readIfThere(new Vec(i, 1)) + reflected(new Vec(i, 1)).length;
}
console.log("after 2000 honest values", warm);

const denies = { has: (_: object, key: string | symbol) => (log.push("has:" + String(key)), false) };
const affirms = { has: (_: object, key: string | symbol) => (log.push("has:" + String(key)), true) };

logged("a vector that denies everything: x", () => hasX(new Proxy<Vec>(new Vec(3, 4), denies)));
logged("a vector that denies everything: norm", () => hasNorm(new Proxy<Vec>(new Vec(3, 4), denies)));
logged("a vector that denies everything: read if there", () => readIfThere(new Proxy<Vec>(new Vec(3, 4), denies)));
logged("a vector that denies everything: other questions", () => reflected(new Proxy<Vec>(new Vec(3, 4), denies)));
logged("a circle that denies its radius", () => size(new Proxy<Circle>({ radius: 5 }, denies)));
logged("a square that claims a radius", () => size(new Proxy<Square>({ side: 5 }, affirms)));
logged("a circle that forwards", () => size(new Proxy<Circle>({ radius: 5 }, { has: (target, key) => (log.push("has:" + String(key)), Reflect.has(target, key)) })));
logged("denying a member that cannot be configured", () => {
  const fixed = Object.defineProperty(new Vec(3, 4), "x", { configurable: false });
  return hasX(new Proxy<Vec>(fixed, denies));
});
logged("denying a member of an object that cannot be extended", () => hasX(new Proxy<Vec>(Object.preventExtensions(new Vec(3, 4)), denies)));
logged("a has trap that throws", () => hasX(new Proxy(new Vec(3, 4), { has: () => { throw new RangeError("no"); } })));
logged("in, through an object whose prototype is the proxy", () => {
  const child: Vec = Object.create(new Proxy<Vec>(new Vec(3, 4), denies));
  return [hasX(child), child.x];
});
logged("honest again", () => [hasX(new Vec(3, 4)), size({ radius: 1 }), size({ side: 1 })]);

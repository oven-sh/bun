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

class Tagged extends Vec {
  get [Symbol.toStringTag](): string {
    return "Tagged";
  }
  toString(): string {
    return "tagged " + this.x;
  }
}

function tag(value: Vec): string {
  return Object.prototype.toString.call(value);
}

function text(value: Vec): string {
  return String(value);
}

function inATemplate(value: Vec): string {
  return `<${value}>`;
}

function added(value: Vec): string {
  return value + "!";
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += tag(new Vec(i, 1)).length + text(new Vec(i, 1)).length + inATemplate(new Tagged(i, 1)).length + added(new Tagged(i, 1)).length;
console.log("after 2000 honest vectors", warm);

function bare(prototype: object): Vec {
  return Object.create(prototype);
}
function orphan(source: Vec): Vec {
  return Object.assign(Object.create(null), source);
}
function parsed(source: Vec): Vec {
  return JSON.parse(JSON.stringify(source));
}

const makers: [string, () => Vec][] = [
  ["a vector", () => new Vec(3, 4)],
  ["a tagged vector", () => new Tagged(3, 4)],
  ["a proxy of a vector", () => new Proxy(new Vec(3, 4), {})],
  ["a proxy of a tagged vector", () => new Proxy(new Tagged(3, 4), {})],
  ["a clone of a tagged vector", () => structuredClone(new Tagged(3, 4))],
  ["the bare prototype of the tagged vector", () => bare(Tagged.prototype)],
  ["a child of a tagged vector", () => bare(new Tagged(3, 4))],
  ["an assigned copy of a tagged vector", () => Object.assign({}, new Tagged(3, 4))],
  ["a parsed copy of a tagged vector", () => parsed(new Tagged(3, 4))],
  ["a copy without a prototype", () => orphan(new Tagged(3, 4))],
];
for (const [name, make] of makers) {
  attempt(name + ": tag", () => tag(make()));
  attempt(name + ": String()", () => text(make()));
  attempt(name + ": in a template", () => inATemplate(make()));
  attempt(name + ": added to a string", () => added(make()));
}

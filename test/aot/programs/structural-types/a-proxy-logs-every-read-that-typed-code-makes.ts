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
    get(inner, key, receiver) {
      log.push(String(key));
      return Reflect.get(inner, key, receiver);
    },
  });
}

const uses: [string, (v: Vec) => unknown][] = [
  ["x + y", v => v.x + v.y],
  ["y - x", v => v.y - v.x],
  ["x + x", v => v.x + v.x],
  ["x * x + y * y", v => v.x * v.x + v.y * v.y],
  ["x three times in a loop", v => {
    let total = 0;
    for (let i = 0; i < 3; i++) total += v.x;
    return total;
  }],
  ["x as the bound of a loop", v => {
    let count = 0;
    for (let i = 0; i < v.x; i++) count++;
    return count;
  }],
  ["a read that is not used", v => {
    v.x;
    return "nothing";
  }],
  ["a read into a variable that is not used", v => {
    const unused = v.y;
    return "nothing";
  }],
  ["the taken arm only", v => (v.x > 0 ? v.y : v.name)],
  ["&& stops", v => v.x < 0 && v.y],
  ["|| stops", v => v.x || v.y],
  ["?? stops", v => v.x ?? v.y],
  ["arguments in order", v => Math.max(v.y, v.x, v.y)],
  ["an array literal in order", v => [v.y, v.x]],
  ["an object literal in order", v => ({ b: v.y, a: v.x })],
  ["a template in order", v => `${v.name}:${v.y}:${v.x}`],
  ["a pattern in its own order", v => {
    const { y, name, x } = v;
    return [x, y, name];
  }],
  ["a pattern with a default", v => {
    const { x = -1 } = v;
    return x;
  }],
  ["norm()", v => v.norm()],
  ["the getter", v => v.sum],
  ["typeof a member", v => typeof v.x],
  ["compared with itself", v => v.x === v.x],
  ["a switch", v => {
    switch (v.x) {
      case v.y:
        return "same";
      case 3:
        return "three";
      default:
        return "other";
    }
  }],
  ["before and after a call", v => {
    const before = v.x;
    Math.abs(1);
    return before + v.x;
  }],
  ["in a closure, called twice", v => {
    const read = () => v.x;
    return read() + read();
  }],
  ["String()", v => String(v.name)],
  ["JSON", v => JSON.stringify(v)],
  ["spread", v => ({ ...v })],
];

for (const [, use] of uses) for (let i = 0; i < 500; i++) use(new Vec(3, 4));
console.log("after 500 honest vectors at every use");

for (const [name, use] of uses) logged(name, () => use(watched(new Vec(3, 4))));

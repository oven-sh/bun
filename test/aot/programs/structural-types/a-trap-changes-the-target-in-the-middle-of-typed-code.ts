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

function total(v: Vec): number {
  return v.x + v.y;
}

function nameThenTotal(v: Vec): string {
  return v.name + ":" + (v.x + v.y);
}

function normTwice(v: Vec): number[] {
  return [v.norm(), v.norm()];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(new Vec(i, 1)) + nameThenTotal(new Vec(i, 1)).length + normTwice(new Vec(3, 4))[1];
console.log("after 2000 honest vectors", warm);

function onRead(of: string, change: (target: Vec) => void): [Vec, Vec] {
  const target = new Vec(3, 4);
  let done = false;
  const proxy = new Proxy(target, {
    get(inner, key, receiver) {
      if (key === of && !done) {
        done = true;
        log.push("changed at " + of);
        change(inner);
      }
      return Reflect.get(inner, key, receiver);
    },
  });
  return [proxy, target];
}

const changes: [string, (target: Vec) => void][] = [
  ["y is deleted", target => void Reflect.deleteProperty(target, "y")],
  ["y becomes a string", target => void Reflect.set(target, "y", "four")],
  ["y becomes a getter", target => void Object.defineProperty(target, "y", { get: () => (log.push("getter"), 40), configurable: true })],
  ["a member is added", target => void Reflect.set(target, "extra", 1)],
  ["many members are added", target => {
    for (let i = 0; i < 100; i++) Reflect.set(target, "extra" + i, i);
  }],
  ["the prototype is removed", target => void Object.setPrototypeOf(target, null)],
  ["norm is covered by an own member", target => void Object.defineProperty(target, "norm", { value: () => -1, configurable: true })],
  ["the target is frozen", target => void Object.freeze(target)],
  ["x and y are swapped by deleting and adding", target => {
    const { x, y } = target;
    Reflect.deleteProperty(target, "x");
    Reflect.deleteProperty(target, "y");
    target.y = x;
    target.x = y;
  }],
];
for (const [name, change] of changes) {
  logged(name + " at the read of x: x + y", () => total(onRead("x", change)[0]));
  logged(name + " at the read of the name: name and total", () => nameThenTotal(onRead("name", change)[0]));
  logged(name + " at the read of norm: norm twice", () => normTwice(onRead("norm", change)[0]));
  logged(name + ": the target afterwards, used directly", () => {
    const [proxy, target] = onRead("x", change);
    total(proxy);
    return [total(target), Object.keys(target).slice(0, 5), typeof target.norm];
  });
}

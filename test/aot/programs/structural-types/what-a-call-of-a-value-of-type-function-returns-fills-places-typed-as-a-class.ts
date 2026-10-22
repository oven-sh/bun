class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  norm(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
}

class Pixel {
  constructor(
    public x: number,
    public y: number,
  ) {}
  norm(): number {
    return -1;
  }
}

class Far extends Point {
  norm(): number {
    return 1000 + super.norm();
  }
}

function changed(change: (p: Point) => void): Point {
  const p = new Point(1, 2);
  change(p);
  return p;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function" || typeof value === "symbol") return typeof value;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  for (const key of Object.keys(value)) parts.push(key + ": " + show(Reflect.get(value, key)));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

const things = {
  honest: new Point(1, 2),
  lookAlike: new Pixel(1, 2),
  subclass: new Far(1, 2),
  literal: { x: 1, y: 2, norm: () => 50 },
  noMethod: { x: 1, y: 2 },
  copied: { ...new Point(1, 2) },
  created: Object.create(Point.prototype),
  heir: Object.create(new Point(1, 2)),
  ownMethod: changed(p => Object.defineProperty(p, "norm", { value: () => 60, configurable: true })),
  otherParent: changed(p => Object.setPrototypeOf(p, Pixel.prototype)),
  noParent: changed(p => Object.setPrototypeOf(p, null)),
  lostField: changed(p => Reflect.deleteProperty(p, "x")),
  accessor: changed(p =>
    Object.defineProperty(p, "x", {
      get() {
        log.push("x");
        return "1";
      },
      configurable: true,
    }),
  ),
  proxy: new Proxy(new Point(1, 2), {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
  }),
  frozen: Object.freeze(new Point(1, 2)),
  texts: changed(p => Reflect.set(p, "x", "1")),
  prototypeItself: Point.prototype,
  classItself: Point,
  nothing: null,
  text: "xy",
};
const names = Object.keys(things);

const all = new Map<string, unknown>(Object.entries(things));
const lookUp: Function = (name: string) => all.get(name);
let turn = 0;

function get(name: string) {
  switch (turn++ % 4) {
    case 0:
      return lookUp(name);
    case 1:
      return lookUp.call(undefined, name);
    case 2:
      return lookUp.apply(undefined, [name]);
    default:
      return lookUp.bind(undefined, name)();
  }
}

function norm(p: Point): number {
  return p.norm();
}

function sum(p: Point): number {
  return p.x + p.y;
}

class Holder {
  p: Point;
  constructor(name: string) {
    this.p = get(name);
  }
  norm(): number {
    return this.p.norm() + this.p.x;
  }
}

console.log("honest callers: " + [norm(new Point(1, 2)), norm(new Point(3, 4)), sum(new Point(5, 6)), norm(new Far(7, 8))].join(" "));

const sinks: [string, (name: string) => unknown][] = [
  [
    "a local",
    name => {
      const p: Point = get(name);
      return [p.x, p.y, p.x + p.y, p instanceof Point];
    },
  ],
  [
    "a method of a local",
    name => {
      const p: Point = get(name);
      return [p.norm(), typeof p.norm];
    },
  ],
  ["a field", name => new Holder(name).norm()],
  ["a parameter", name => [sum(get(name)), norm(get(name))]],
  [
    "an element",
    name => {
      const list: Point[] = [new Point(1, 2), get(name)];
      list.push(get(name));
      let total = 0;
      for (const p of list) total += p.norm();
      return [total, list[1].y];
    },
  ],
  [
    "a map value",
    name => {
      const map = new Map<string, Point>([["first", new Point(1, 2)]]);
      map.set("second", get(name));
      let total = 0;
      for (const p of map.values()) total += p.y;
      return total;
    },
  ],
  [
    "its keys",
    name => {
      const p: Point = get(name);
      return [Object.keys(p).join(), JSON.stringify(p), p.constructor === Point];
    },
  ],
];

for (const [sink, run] of sinks) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run("honest");
    rounds++;
  }
  console.log(sink + ": " + rounds + " honest rounds");
  for (const name of names) attempt(sink + ", " + name, () => run(name));
  attempt(sink + ", honest again", () => run("honest"));
}

export {};

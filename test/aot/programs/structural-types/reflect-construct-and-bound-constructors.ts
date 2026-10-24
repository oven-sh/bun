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

const log: string[] = [];

class Point {
  x: number;
  y: number;
  label = "point";
  constructor(x: number = -1, y: number = -2) {
    log.push("Point(" + x + ", " + y + ") for " + new.target.name);
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}

class Point3 extends Point {
  z = 3;
  sum(): number {
    return super.sum() + this.z;
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function call(p: Point): number {
  return p.sum();
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(new Point(i, 1)) + call(new Point(i, 1)) + call(new Point3(i, 1));
console.log("after 2000 honest points", warm);

const BoundOne = Point.bind(null, 10);
const BoundBoth = Point.bind(null, 10, 20);
const BoundTwice = BoundOne.bind(null, 30);

const makers: [string, () => Point][] = [
  ["new", () => new Point(1, 2)],
  ["Reflect.construct", () => Reflect.construct(Point, [1, 2])],
  ["Reflect.construct without arguments", () => Reflect.construct(Point, [])],
  ["Reflect.construct with one argument", () => Reflect.construct(Point, [1])],
  ["Reflect.construct with too many", () => Reflect.construct(Point, [1, 2, 3, 4])],
  ["Reflect.construct with an array-like", () => Reflect.construct(Point, { 0: 1, 1: 2, length: 2 })],
  ["Reflect.construct with strings", () => Reflect.construct(Point, ["one", "two"])],
  ["Reflect.construct for itself", () => Reflect.construct(Point, [1, 2], Point)],
  ["Reflect.construct for the subclass", () => Reflect.construct(Point, [1, 2], Point3)],
  ["Reflect.construct of the subclass", () => Reflect.construct(Point3, [1, 2])],
  ["a constructor bound to one argument", () => new BoundOne(2)],
  ["a constructor bound to both", () => new BoundBoth()],
  ["a constructor bound twice", () => new BoundTwice()],
  ["Reflect.construct of a bound constructor", () => Reflect.construct(BoundOne, [2])],
  ["the constructor read from an instance", () => Reflect.construct(new Point(0, 0).constructor, [1, 2])],
  ["the constructor in a variable", () => {
    const Class: new (x: number, y: number) => Point = Point;
    return new Class(1, 2);
  }],
  ["spread arguments", () => new Point(...([1, 2] satisfies [number, number]))],
];
for (const [name, make] of makers) {
  log.length = 0;
  attempt(name, () => {
    const made = make();
    return [made.x, made.y, made.label, Object.keys(made), made instanceof Point, made instanceof Point3, made.constructor.name];
  });
  console.log("  log: " + log.join("; "));
  attempt(name + ": x + y", () => sum(make()));
  attempt(name + ": sum()", () => call(make()));
}
attempt("bound constructors: name, length, prototype", () => [BoundOne.name, BoundOne.length, "prototype" in BoundOne, new BoundOne(2) instanceof BoundOne]);
attempt("called without new", () => Reflect.apply(Point, undefined, [1, 2]));
attempt("Reflect.construct of what is no constructor", () => Reflect.construct(Math.max, [1, 2]));
attempt("Reflect.construct for what is no constructor", () => Reflect.construct(Point, [1, 2], Math.max));

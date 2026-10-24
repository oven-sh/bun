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

interface Shape {
  name: string;
  side: number;
  area(): number;
  readonly perimeter: number;
}

class Square implements Shape {
  name = "square";
  side: number;
  constructor(side: number) {
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
  get perimeter(): number {
    return this.side * 4;
  }
}

function literal(side: number): Shape {
  return {
    name: "literal",
    side,
    area() {
      return this.side * this.side;
    },
    get perimeter() {
      return this.side * 4;
    },
  };
}

function copy(shape: Shape): Shape {
  return { ...shape };
}

function copyAndResize(shape: Shape, side: number): Shape {
  return { ...shape, side };
}

function assigned(shape: Shape): Shape {
  return Object.assign({}, shape);
}

function area(shape: Shape): number {
  return shape.area();
}

function perimeter(shape: Shape): number {
  return shape.perimeter + 1;
}

function side(shape: Shape): number {
  return shape.side * 2;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += area(new Square(i)) + perimeter(new Square(i)) + side(new Square(i)) + area(literal(i)) + perimeter(literal(i)) + area(copy(literal(i)));
}
console.log("after 2000 honest shapes", warm);

const makers: [string, () => Shape][] = [
  ["an instance", () => new Square(3)],
  ["a literal", () => literal(3)],
  ["a spread of an instance", () => copy(new Square(3))],
  ["a spread of a literal", () => copy(literal(3))],
  ["a resized spread of an instance", () => copyAndResize(new Square(3), 5)],
  ["a resized spread of a literal", () => copyAndResize(literal(3), 5)],
  ["an assigned copy of an instance", () => assigned(new Square(3))],
  ["an assigned copy of a literal", () => assigned(literal(3))],
  ["a spread of a spread", () => copy(copy(new Square(3)))],
];
for (const [name, make] of makers) {
  attempt(name + ": side * 2", () => side(make()));
  attempt(name + ": area", () => area(make()));
  attempt(name + ": perimeter + 1", () => perimeter(make()));
  attempt(name + ": kinds", () => [typeof make().area, typeof make().perimeter, make() instanceof Square]);
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": the perimeter follows the side", () => {
    const shape = make();
    shape.side = 10;
    return shape.perimeter;
  });
}
attempt("in one array", () => makers.map(([, make]) => side(make())));
attempt("honest again", () => [area(new Square(3)), perimeter(literal(3))]);

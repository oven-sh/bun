function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Shape {
  sides: number;
  label: string;
}
class Shape {
  id: number = 1;
  corners(): number {
    return this.sides;
  }
  heading(): string {
    return this.label + " with " + this.sides;
  }
}

class Square extends Shape {
  sides: number = 4;
  label: string = "square";
}

class Triangle extends Shape {
  constructor() {
    super();
    this.label = "triangle";
    this.sides = 3;
  }
}

class Round extends Shape {
  get sides(): number {
    return 0;
  }
  get label(): string {
    return "round";
  }
}

class Lump extends Shape {
  soft: boolean = true;
}

function sidesOf(shape: Shape): number {
  return shape.sides;
}

function widthOf(shape: Shape): number {
  return shape.label.length;
}

show("the first call gets the base class", () => sidesOf(new Shape()));
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const shape = i % 3 === 0 ? new Square() : i % 3 === 1 ? new Triangle() : new Round();
  sum += sidesOf(shape) + widthOf(shape) + shape.corners();
}
show("2000 that make them", () => sum);
for (const shape of [new Square(), new Triangle(), new Round(), new Lump(), new Shape()]) {
  const kind = shape.constructor.name;
  show(kind + ": sides", () => sidesOf(shape));
  show(kind + ": plus one", () => sidesOf(shape) + 1);
  show(kind + ": corners", () => shape.corners());
  show(kind + ": width", () => widthOf(shape));
  show(kind + ": heading", () => shape.heading());
  show(kind + ": keys", () => Object.keys(shape));
  show(kind + ": in", () => "sides" in shape);
}

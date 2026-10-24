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

abstract class Shape {
  abstract sides: number;
  copy: number;
  doubled: number;
  whole: number;
  constructor() {
    this.copy = this.sidesNow();
    this.doubled = this.sidesNow() * 2;
    this.whole = this.sidesNow() | 0;
  }
  sidesNow(): number {
    return this.sides;
  }
  copyPlusOne(): number {
    return this.copy + 1;
  }
}

class ByField extends Shape {
  sides: number = 4;
}

class ByGetter extends Shape {
  get sides(): number {
    return 3;
  }
}

class ByParameter extends Shape {
  constructor(public sides: number) {
    super();
  }
}

class ByStore extends Shape {
  sides: number;
  constructor() {
    super();
    this.sides = 6;
  }
}

function copyOf(shape: Shape): number {
  return shape.copy;
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += copyOf(new ByGetter()) + new ByGetter().doubled + new ByGetter().copyPlusOne();
show("2000 that have it in time", () => sum);

for (const shape of [new ByGetter(), new ByField(), new ByParameter(5), new ByStore()]) {
  const kind = shape.constructor.name;
  show(kind + ": sides now", () => shape.sides);
  show(kind + ": the copy", () => [shape.copy, typeof shape.copy, copyOf(shape)]);
  show(kind + ": the copy plus one", () => [shape.copy + 1, shape.copyPlusOne()]);
  show(kind + ": doubled", () => shape.doubled);
  show(kind + ": whole", () => shape.whole);
  show(kind + ": keys", () => Object.keys(shape));
  show(kind + ": JSON", () => JSON.stringify(shape));
}

const shapes: Shape[] = [new ByGetter(), new ByField(), new ByGetter()];
show("copies", () => shapes.map(copyOf));
show("copies added", () => shapes.reduce((total, shape) => total + shape.copy, 0));
show("copies as doubles", () => Array.from(Float64Array.from(shapes, copyOf)));

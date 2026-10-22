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

interface Vector {
  z: number;
}
class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  squared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  plus(other: Vector): Vector {
    const sum = new Vector(this.x + other.x, this.y + other.y);
    sum.z = this.z + other.z;
    return sum;
  }
}

function deep(x: number, y: number, z: number): Vector {
  const vector = new Vector(x, y);
  vector.z = z;
  return vector;
}

function parts(vector: Vector): unknown[] {
  return [vector.x, vector.y, vector.z];
}

const flat = new Vector(1.5, 2.5);
show("parts", () => parts(flat));
show("squared", () => flat.squared());
show("keys", () => Object.keys(flat));
show("JSON", () => JSON.stringify(flat));
show("flat plus flat", () => parts(flat.plus(flat)));
show("keys of the sum", () => Object.keys(flat.plus(flat)));
show("flat plus deep", () => parts(flat.plus(deep(1, 1, 1))));
show("deep plus deep", () => parts(deep(1, 2, 3).plus(deep(0.5, 0.5, 0.5))));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += deep(i, 1, 0.5).squared();
show("2000 deep ones", () => sum);
show("a flat one", () => new Vector(3, 4).squared());
show("a deep one", () => deep(3, 4, 0).squared());

const many: Vector[] = [];
for (let i = 0; i < 6; i++) many.push(i % 3 === 2 ? new Vector(i, i) : deep(i, i, i));
show("z of six", () => many.map(v => v.z));
show("x of six", () => many.map(v => v.x));
show("z added up", () => many.reduce((total, v) => total + v.z, 0));
show("z added up where it is a number", () => many.reduce((total, v) => total + (typeof v.z === "number" ? v.z : 100), 0));
show("in a typed array", () => Array.from(new Float64Array(many.map(v => v.z))));
show("in a typed array of whole numbers", () => Array.from(new Int32Array(many.map(v => v.z))));

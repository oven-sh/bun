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
  abstract label: string;
  abstract area(): number;
  twice(): number {
    return this.sides * 2;
  }
  heading(): string {
    return this.label + "!";
  }
  bigger(): number {
    return this.area() + 1;
  }
}

class Honest extends Shape {
  sides: number = 4;
  label: string = "honest";
  area(): number {
    return 16;
  }
}

class Declared extends Shape {
  declare sides: number;
  declare label: string;
  declare area: () => number;
}

interface Merged {
  sides: number;
  label: string;
  area(): number;
}
class Merged extends Shape {}

function sidesOf(shape: Shape): number {
  return shape.sides;
}

function areaOf(shape: Shape): number {
  return shape.area();
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += sidesOf(new Honest()) + areaOf(new Honest()) + new Honest().twice();
show("2000 honest ones", () => sum);

for (const shape of [new Declared(), new Merged(), new Honest()]) {
  const kind = shape.constructor.name;
  show(kind + ": sides", () => sidesOf(shape));
  show(kind + ": twice", () => shape.twice());
  show(kind + ": label", () => shape.label);
  show(kind + ": heading", () => shape.heading());
  show(kind + ": typeof area", () => typeof shape.area);
  show(kind + ": area", () => areaOf(shape));
  show(kind + ": bigger", () => shape.bigger());
  show(kind + ": keys", () => Object.keys(shape));
  show(kind + ": in", () => ["sides" in shape, "area" in shape]);
}

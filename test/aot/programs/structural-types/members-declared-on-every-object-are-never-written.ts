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

declare global {
  interface Object {
    tag: string;
    weight: number;
    describe(): string;
  }
}

class Point {
  x: number = 1;
  y: number = 2;
  heavier(): number {
    return this.weight + this.x;
  }
}

function tagOf(value: object): string {
  return value.tag;
}

function weightOf(value: Point): number {
  return value.weight;
}

const point = new Point();
const literal = { a: 1 };
show("an instance", () => [point.tag, point.weight, typeof point.describe]);
show("an instance: plus one", () => point.weight + 1);
show("an instance: in its method", () => point.heavier());
show("an instance: through a function", () => [tagOf(point), weightOf(point)]);
show("an instance: called", () => point.describe());
show("an instance: the length of the text", () => point.tag.length);
show("a literal", () => [literal.tag, literal.weight, tagOf(literal)]);
show("a literal: called", () => literal.describe());
show("a list", () => [[1].tag, [1].weight]);
show("a function", () => [tagOf.tag, tagOf.weight]);
show("a number", () => [(5).tag, (5).weight]);
show("a number: plus one", () => (5).weight + 1);
show("a string", () => ["s".tag, "s".weight]);
show("a boolean", () => [true.tag, true.weight]);
show("a regular expression", () => /a/.tag);
show("an object without a prototype", () => {
  const bare: object = Object.create(null);
  return tagOf(bare);
});
show("keys", () => [Object.keys(point), Object.keys(literal)]);
show("in", () => ["tag" in point, "toString" in point]);

point.weight = 3;
point.tag = "stored";
show("after stores on one", () => [point.weight, point.heavier(), weightOf(point), tagOf(point), Object.keys(point)]);
show("another instance", () => [new Point().weight, new Point().heavier(), tagOf(new Point())]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += weightOf(point);
show("2000 reads where it is", () => sum);
show("one where it is not", () => [weightOf(new Point()), weightOf(new Point()) + 1]);

export {};

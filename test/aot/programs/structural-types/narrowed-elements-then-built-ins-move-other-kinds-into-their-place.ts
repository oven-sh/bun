function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

type Values = (number | string)[];
type Shapes = Shape[];

const ways: [string, (values: Values, shapes: Shapes) => unknown][] = [
  ["nothing", () => 0],
  ["fill", (values, shapes) => [values.fill("text"), shapes.fill(new Shape())]],
  ["splice", (values, shapes) => [values.splice(0, 1, "text"), shapes.splice(0, 1, new Shape())]],
  ["unshift", (values, shapes) => [values.unshift("text"), shapes.unshift(new Shape())]],
  ["reverse", (values, shapes) => [values.reverse(), shapes.reverse()]],
  ["copyWithin", (values, shapes) => [values.copyWithin(0, 2), shapes.copyWithin(0, 2)]],
  ["sort", (values, shapes) => [values.sort((a, b) => (typeof a === "string" ? -1 : typeof b === "string" ? 1 : 0)), shapes.sort((a, b) => (a instanceof Square ? 1 : 0) - (b instanceof Square ? 1 : 0))]],
  ["shift", (values, shapes) => [values.shift(), values.shift(), shapes.shift(), shapes.shift()]],
  ["a shorter length", (values, shapes) => [(values.length = 0), (shapes.length = 0)]],
  ["Object.assign", (values, shapes) => [Object.assign(values, ["text"]), Object.assign(shapes, [new Shape()])]],
  ["Reflect.set", (values, shapes) => [Reflect.set(values, 0, "text"), Reflect.set(shapes, 0, new Shape())]],
  ["an array pattern", (values, shapes) => {
    [values[0], shapes[0]] = ["text", new Shape()];
  }],
  ["a swap", (values, shapes) => {
    [values[0], values[2]] = [values[2], values[0]];
    [shapes[0], shapes[2]] = [shapes[2], shapes[0]];
  }],
  ["delete", (values, shapes) => [delete values[0], delete shapes[0]]],
  ["a getter on the index", (values, shapes) => {
    Object.defineProperty(values, 0, { get: () => "text" });
    Object.defineProperty(shapes, 0, { get: () => new Shape() });
  }],
  ["push through call on the first slot", (values, shapes) => {
    values.length = 0;
    shapes.length = 0;
    Array.prototype.push.call(values, "text");
    Array.prototype.push.call(shapes, new Shape());
  }],
];

function read(values: Values, shapes: Shapes, way: (values: Values, shapes: Shapes) => unknown): unknown {
  if (typeof values[0] === "number" && shapes[0] instanceof Square) {
    way(values, shapes);
    return [values[0], values[0] + 1, values[0] * 2, shapes[0]?.edge, shapes[0]?.sides, values.length, shapes.length];
  }
  return "other";
}

const makeValues = (): Values => [1, 2, "text"];
const makeShapes = (): Shapes => [new Square(), new Square(), new Shape()];

for (let i = 0; i < 2000; i++) read(makeValues(), makeShapes(), ways[0][1]);
for (const [name, way] of ways) attempt(name, () => read(makeValues(), makeShapes(), way));
attempt("nothing again", () => read(makeValues(), makeShapes(), ways[0][1]));

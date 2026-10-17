// `constructor` is declared once, in `interface Object`, as a Function for every object. What an object really holds there is its own business.
const lines: string[] = [];
function* numbers() {
  yield 1;
}
async function* later() {
  yield 1;
}
function kind(value: {} | null | undefined): string {
  switch (value?.constructor?.name) {
    case "String":
      return "a string";
    case "Array":
      return "an array";
    default:
      return "something else: " + typeof value?.constructor;
  }
}
function nameOf(value: object): string | undefined {
  return value.constructor.name;
}
function typeOfConstructor(value: object): string {
  const constructor = value.constructor;
  return typeof constructor;
}
function isMadeBy(value: object, maker: Function): boolean {
  return value.constructor === maker;
}
function lengthOf(value: object): unknown {
  return value.constructor.length;
}
class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
  again(): Point {
    return new (this.constructor as typeof Point)(this.y, this.x);
  }
}
class Shadowed {
  declare ["constructor"]: typeof Shadowed;
  static label = "static member";
  label(): string {
    return this.constructor.label;
  }
}
const withoutPrototype: object = Object.create(null);
const withNumber: object = Object.create({ constructor: 5 });
const withString: object = { constructor: "text" };
const withObject: object = { constructor: { name: "an object's name" } };
const withUndefined: object = { constructor: undefined };
const withNull: object = { constructor: null };
lines.push([kind("a"), kind([1]), kind(numbers()), kind(later()), kind(withoutPrototype), kind(null), kind(undefined), kind(1), kind(new Point(1, 2))].join(" | "));
lines.push([kind(withNumber), kind(withString), kind(withObject), kind(withUndefined), kind(withNull)].join(" | "));
for (const [title, value] of [
  ["a generator", numbers()],
  ["an async generator", later()],
  ["a generator function's prototype", numbers.prototype],
  ["a number there", withNumber],
  ["a string there", withString],
  ["an object there", withObject],
  ["an instance", new Point(1, 2)],
  ["an array", []],
  ["a function", kind],
  ["a class", Point],
  ["a Map", new Map()],
  ["a promise", Promise.resolve(1)],
  ["an error", new RangeError("x")],
  ["a bound function", kind.bind(null)],
  ["a proxy", new Proxy({}, { get: () => 7 })],
  ["arguments", (function () { return arguments; })()],
] as [string, object][])
  lines.push(`${title}: ${String(nameOf(value))}, ${typeOfConstructor(value)}, ${isMadeBy(value, Object)}, ${String(lengthOf(value))}`);
for (const [title, value] of [
  ["nothing there", withoutPrototype],
  ["undefined there", withUndefined],
  ["null there", withNull],
] as [string, object][]) {
  lines.push(`${title}: ${typeOfConstructor(value)}, ${isMadeBy(value, Object)}`);
  try {
    lines.push(String(nameOf(value)));
  } catch (error) {
    lines.push(`${title}: reading its name threw ${(error as Error).constructor.name}`);
  }
}
const turned = new Point(1, 2).again();
lines.push(`${turned.x} ${turned.y} ${turned.constructor === Point} ${new Shadowed().label()}`);
console.log(lines.join("\n"));

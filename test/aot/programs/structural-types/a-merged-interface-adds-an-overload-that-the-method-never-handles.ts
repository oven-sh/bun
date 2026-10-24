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

interface Calculator {
  double(value: number | string): number;
  total(list: (number | string)[]): number;
  describe(point: { x: number | string }): number;
  pick(value: number | boolean | undefined): number;
}
class Calculator {
  base: number = 1;
  double(n: number): number {
    return n * 2;
  }
  total(list: number[]): number {
    let sum = this.base;
    for (let i = 0; i < list.length; i++) sum += list[i];
    return sum;
  }
  describe(point: { x: number }): number {
    return point.x + 1;
  }
  pick(n: number): number {
    return n + 1;
  }
}

function plusOne(n: number): number {
  return n + 1;
}

const calculator = new Calculator();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += calculator.double(i) + calculator.total([i, 1]) + calculator.describe({ x: i }) + calculator.pick(i + 0.5);
show("2000 honest rounds", () => warm);

show("a string of digits where the method takes a number", () => [calculator.double("4"), typeof calculator.double("4")]);
show("a word", () => [calculator.double("ab"), typeof calculator.double("ab")]);
show("the empty string", () => calculator.double(""));
show("a list of strings", () => [calculator.total(["a", "b"]), typeof calculator.total(["a", "b"])]);
show("its result is typed number: plus one", () => [calculator.total(["a"]) + 1, plusOne(calculator.total(["a"]))]);
show("its result is typed number: times two", () => calculator.total(["2", "3"]) * 2);
show("its result is typed number: toFixed", () => calculator.total(["a"]).toFixed(1));
show("a list of both", () => calculator.total([1, "2", 3]));
show("an object with a string", () => [calculator.describe({ x: "1" }), typeof calculator.describe({ x: "1" }), plusOne(calculator.describe({ x: "1" }))]);
show("a boolean", () => [calculator.pick(true), calculator.pick(false), typeof calculator.pick(true)]);
show("undefined", () => [calculator.pick(undefined), typeof calculator.pick(undefined)]);
show("taken off and called", () => {
  const double: (value: number | string) => number = calculator.double;
  return [double("5"), double(5)];
});
show("as a callback over strings", () => ["1", "x"].map(text => calculator.double(text)));
show("in a typed list", () => {
  const list: number[] = [calculator.total(["a"]), calculator.describe({ x: "b" }), 1];
  return list;
});
show("honest again", () => [calculator.double(4), plusOne(calculator.double(4)), calculator.total([1, 2]), calculator.describe({ x: 1 }), calculator.pick(2.5)]);

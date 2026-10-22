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

function inspect(numbers: number[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    const exact = Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : Object.is(value, -0) ? "minus zero" : Object.is(value, NaN) ? "not a number" : String(value);
    lines.push(i + " " + (i in numbers ? "present" : "absent") + " " + typeof value + " " + exact);
  }
  return lines;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(number => number * 2);
}

function doubledByHand(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] * 2);
  return result;
}

function report(name: string, make: () => number[]): void {
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": length", () => make().length);
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": sum as integers", () => sumAsIntegers(make()));
  attempt(name + ": map", () => doubled(make()));
  attempt(name + ": doubled by hand", () => doubledByHand(make()));
  attempt(name + ": the first, fixed", () => make()[0].toFixed(1));
  attempt(name + ": after a push", () => {
    const numbers = make();
    const length = numbers.push(7);
    return [length, inspect(numbers), sum(numbers)];
  });
  attempt(name + ": after a store at 1", () => {
    const numbers = make();
    numbers[1] = 1.5;
    return [inspect(numbers), sum(numbers)];
  });
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const dense of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += inspect(dense).length + sum(dense) + sumByForOf(dense) + sumAsIntegers(dense) + doubled(dense)[0] + doubledByHand(dense)[1];
  }
}
console.log("after 4000 dense arrays", warm);

report("new Array<number>(3)", () => new Array<number>(3));
report("new Array<number>(1, 2, 3)", () => new Array<number>(1, 2, 3));
report("new Array<number>(1.5, 2.5, 3.5)", () => new Array<number>(1.5, 2.5, 3.5));
report("Array.of(3)", () => Array.of(3));
report("Array.of(3, 4, 5)", () => Array.of(3, 4, 5));
report("Array.of<number>()", () => Array.of<number>());
report("new Array<number>()", () => new Array<number>());
report("new Array<number>(0)", () => new Array<number>(0));
report("new Array<number>(...[3])", () => new Array<number>(...[3]));
report("new Array<number>(...[3, 4])", () => new Array<number>(...[3, 4]));

function make(first: number): number[] {
  return new Array<number>(first);
}
for (const first of [0, 1, 2, 2.5, -1, NaN, -0, 2 ** 32 - 1, 2 ** 32]) {
  attempt("one argument, " + show(first), () => {
    const numbers = make(first);
    return [numbers.length, 0 in numbers, numbers[0]];
  });
}
attempt("one argument that is a string", () => {
  const texts = new Array<string>("3");
  return [texts.length, texts[0], 0 in texts];
});
attempt("Reflect.construct", () => inspect(Reflect.construct(Array<number>, [3])));
attempt("a subclass with one argument", () => {
  class List extends Array<number> {}
  const list = new List(3);
  return [list.length, 0 in list, inspect(list), List.of(3).length];
});
attempt("the constructor in a variable", () => {
  const Maker: new (length: number) => number[] = Array;
  return inspect(new Maker(2));
});
attempt("the constructor handed to map", () => [1, 2].map(length => new Array<number>(length)).map(inspect));

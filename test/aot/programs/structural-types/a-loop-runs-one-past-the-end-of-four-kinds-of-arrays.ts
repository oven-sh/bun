function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
  twice(): number {
    return this.x * 2;
  }
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i <= numbers.length; i++) total += numbers[i];
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i <= numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function largest(numbers: number[]): number {
  let best = -Infinity;
  for (let i = 0; i <= numbers.length; i++) if (numbers[i] > best) best = numbers[i];
  return best;
}

function countZeros(numbers: number[]): number {
  let count = 0;
  for (let i = 0; i <= numbers.length; i++) if (numbers[i] === 0) count++;
  return count;
}

function countFalsy(numbers: number[]): number {
  let count = 0;
  for (let i = 0; i <= numbers.length; i++) if (!numbers[i]) count++;
  return count;
}

function glue(strings: string[]): string {
  let text = "";
  for (let i = 0; i <= strings.length; i++) text += strings[i];
  return text;
}

function widths(strings: string[]): number {
  let total = 0;
  for (let i = 0; i <= strings.length; i++) total += strings[i].length;
  return total;
}

function xs(points: Point[]): number {
  let total = 0;
  for (let i = 0; i <= points.length; i++) total += points[i].x;
  return total;
}

function twices(points: Point[]): number {
  let total = 0;
  for (let i = 0; i <= points.length; i++) total += points[i].twice();
  return total;
}

function runAll(functions: (() => number)[]): number {
  let total = 0;
  for (let i = 0; i <= functions.length; i++) total += functions[i]();
  return total;
}

function copy(numbers: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i <= numbers.length; i++) out.push(numbers[i]);
  return out;
}

function copyByIndex(numbers: number[]): number[] {
  const out = new Array<number>(numbers.length);
  for (let i = 0; i <= numbers.length; i++) out[i] = numbers[i];
  return out;
}

function pairs(numbers: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < numbers.length; i++) out.push(numbers[i] + numbers[i + 1]);
  return out;
}

function fromMinusOne(numbers: number[]): number {
  let total = 0;
  for (let i = -1; i < numbers.length; i++) total += numbers[i];
  return total;
}

function tupleSum(pair: [number, number]): number {
  let total = 0;
  for (let i = 0; i <= pair.length; i++) total += pair[i];
  return total;
}

attempt("integers: sum", () => sum([1, 2, 3]));
attempt("integers: sum as integers", () => sumAsIntegers([1, 2, 3]));
attempt("integers: largest", () => largest([1, 2, 3]));
attempt("integers: zeros", () => countZeros([0, 1, 0]));
attempt("integers: falsy ones", () => countFalsy([0, 1, 0]));
attempt("fractions: sum", () => sum([0.5, 1.5]));
attempt("fractions: zeros", () => countZeros([0.5, 0, -0]));
attempt("fractions: largest", () => largest([0.5, 1.5]));
attempt("an empty list", () => [sum([]), sumAsIntegers([]), largest([]), countZeros([]), countFalsy([])]);
attempt("strings: glued", () => glue(["a", "b"]));
attempt("strings: widths", () => widths(["a", "b"]));
attempt("points: xs", () => xs([new Point(1)]));
attempt("points: twices", () => twices([new Point(1)]));
attempt("functions", () => runAll([() => 1]));
attempt("a copy by push", () => copy([1, 2]));
attempt("a copy by index", () => copyByIndex([1, 2]));
attempt("a copy of fractions", () => [copy([0.5]), copyByIndex([0.5])]);
attempt("a copy, summed honestly", () => copy([1, 2]).reduce((a, b) => a + b, 0));
attempt("each with its neighbor", () => [pairs([1, 2, 3]), pairs([0.5]), pairs([])]);
attempt("from minus one", () => fromMinusOne([1, 2]));
attempt("a tuple", () => tupleSum([1, 2]));

export {};

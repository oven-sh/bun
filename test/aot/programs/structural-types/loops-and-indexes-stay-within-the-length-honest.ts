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
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

type Entry = [number, string];

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function dot(a: number[], b: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}

function widths(strings: string[]): number {
  let total = 0;
  for (let i = 0; i < strings.length; i++) total += strings[i].length;
  return total;
}

function xs(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x + points[i].y;
  return total;
}

function runAll(functions: (() => number)[]): number {
  let total = 0;
  for (let i = 0; i < functions.length; i++) total += functions[i]();
  return total;
}

function weigh(entry: Entry): number {
  return entry[0] * 2 + entry[1].length;
}

function codes(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) total += text.charCodeAt(i);
  return total;
}

function viewSum(view: Float64Array): number {
  let total = 0;
  for (let i = 0; i < view.length; i++) total += view[i];
  return total;
}

const integers: number[] = [];
const fractions: number[] = [];
const strings: string[] = [];
const points: Point[] = [];
const functions: (() => number)[] = [];
const view = new Float64Array(64);
for (let i = 0; i < 64; i++) {
  integers.push(i);
  fractions.push(i / 4);
  strings.push("s" + i);
  points.push(new Point(i, i / 2));
  functions.push(() => i);
  view[i] = i / 8;
}

let total = 0;
for (let round = 0; round < 2000; round++) {
  integers[round % 64] = round;
  fractions[round % 64] = round / 4;
  const entry: Entry = [round, "entry"];
  total += sum(integers) + sum(fractions) + dot(integers, fractions) + widths(strings) + xs(points) + runAll(functions) + weigh(entry) + codes("some text") + viewSum(view);
}
console.log("total " + total);
console.log(integers.length + " " + fractions.length + " " + strings.length + " " + points.length + " " + functions.length + " " + view.length);
console.log(typeof integers[63] + " " + typeof fractions[63] + " " + typeof strings[63] + " " + typeof points[63] + " " + typeof functions[63] + " " + typeof view[63]);

export {};

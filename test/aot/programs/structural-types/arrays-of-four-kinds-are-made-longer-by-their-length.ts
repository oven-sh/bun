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
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function widths(strings: string[]): number {
  let total = 0;
  for (let i = 0; i < strings.length; i++) total += strings[i].length;
  return total;
}

function glue(strings: string[]): string {
  let text = "";
  for (let i = 0; i < strings.length; i++) text += strings[i];
  return text;
}

function xs(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x;
  return total;
}

function runAll(functions: (() => number)[]): number {
  let total = 0;
  for (let i = 0; i < functions.length; i++) total += functions[i]();
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum([i, 1]) + sum([0.5, i]) + widths(["a", "bc"]) + glue(["a", "b"]).length + xs([new Point(i)]) + runAll([() => i]);
console.log("2000 honest rounds: " + warm);

const integers = [1, 2];
integers.length = 4;
console.log("integers: " + show(integers));
attempt("  typeof [3]", () => typeof integers[3]);
attempt("  [3] + 1", () => integers[3] + 1);
attempt("  [3] | 0", () => integers[3] | 0);
attempt("  [3] === 0", () => integers[3] === 0);
attempt("  sum", () => sum(integers));
attempt("  3 in it", () => 3 in integers);

const fractions = [0.5, 1.5];
fractions.length = 3;
console.log("fractions: " + show(fractions));
attempt("  typeof [2]", () => typeof fractions[2]);
attempt("  [2] * 2", () => fractions[2] * 2);
attempt("  [2] is not a number", () => [Number.isNaN(fractions[2]), fractions[2] === undefined]);
attempt("  sum", () => sum(fractions));

const strings = ["a", "b"];
strings.length = 3;
console.log("strings: " + show(strings));
attempt("  typeof [2]", () => typeof strings[2]);
attempt("  [2] === ''", () => strings[2] === "");
attempt("  [2] + '!'", () => strings[2] + "!");
attempt("  [2].length", () => strings[2].length);
attempt("  widths", () => widths(strings));
attempt("  glued", () => glue(strings));
attempt("  joined", () => strings.join("-"));

const points = [new Point(1)];
points.length = 2;
console.log("points: " + show(points));
attempt("  typeof [1]", () => typeof points[1]);
attempt("  [1] === null", () => points[1] === null);
attempt("  [1].x", () => points[1].x);
attempt("  [1].twice()", () => points[1].twice());
attempt("  [1]?.x", () => points[1]?.x);
attempt("  xs", () => xs(points));

const functions: (() => number)[] = [() => 1];
functions.length = 2;
console.log("functions: " + show(functions));
attempt("  typeof [1]", () => typeof functions[1]);
attempt("  [1]()", () => functions[1]());
attempt("  [1]?.()", () => functions[1]?.());
attempt("  all run", () => runAll(functions));
attempt("  all run by for of", () => {
  let total = 0;
  for (const f of functions) total += f();
  return total;
});
attempt("  all run by forEach: holes are skipped", () => {
  let total = 0;
  functions.forEach(f => (total += f()));
  return total;
});

export {};

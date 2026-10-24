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
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function zeros(numbers: number[]): number {
  let count = 0;
  for (let i = 0; i < numbers.length; i++) if (numbers[i] === 0) count++;
  return count;
}

function empties(strings: string[]): number {
  let count = 0;
  for (let i = 0; i < strings.length; i++) if (strings[i] === "") count++;
  return count;
}

function glue(strings: string[]): string {
  let text = "";
  for (let i = 0; i < strings.length; i++) text += "<" + strings[i] + ">";
  return text;
}

function xs(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x;
  return total;
}

function honestIntegers(i: number): number {
  return sum([i, 0, 2]) + zeros([i + 1, 0, 0]);
}

function honestFractions(i: number): number {
  return sum([i / 2, 0.25]) + zeros([0.5, 0]);
}

function honestStrings(i: number): number {
  return empties(["", "a" + i]) + glue(["a", ""]).length;
}

function honestPoints(i: number): number {
  return xs([new Point(i), new Point(1)]);
}

function sparse<T>(first: T, last: T): T[] {
  const list = [first];
  list[3] = last;
  return list;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += honestIntegers(i) + honestFractions(i) + honestStrings(i) + honestPoints(i);
console.log("2000 honest rounds: " + total);

attempt("sparse integers: sum", () => sum(sparse(1, 2)));
attempt("sparse integers: zeros", () => zeros(sparse(0, 0)));
attempt("sparse fractions: sum", () => sum(sparse(0.5, 1.5)));
attempt("sparse fractions: zeros", () => zeros(sparse(0.5, 0)));
attempt("sparse strings: empties", () => empties(sparse("", "")));
attempt("sparse strings: glued", () => glue(sparse("a", "b")));
attempt("sparse points", () => xs(sparse(new Point(1), new Point(2))));
attempt("honest callers afterwards", () => [honestIntegers(1), honestFractions(1), honestStrings(1), honestPoints(1)]);

attempt("holes and then honest, one list", () => {
  const numbers = sparse(1, 2);
  const before = sum(numbers);
  numbers[1] = 10;
  numbers[2] = 20;
  return [before, sum(numbers), zeros(numbers), show(numbers)];
});
attempt("honest and then a hole, one list", () => {
  const numbers = [1, 2, 3];
  const before = sum(numbers);
  delete numbers[1];
  return [before, sum(numbers), zeros(numbers), show(numbers)];
});
attempt("a hole in a list of lists", () => {
  const grid: number[][] = sparse([1], [2]);
  return grid.map(row => sum(row));
});
attempt("a hole in a list of lists, by a loop", () => {
  const grid: number[][] = sparse([1], [2]);
  let all = 0;
  for (let i = 0; i < grid.length; i++) all += sum(grid[i]);
  return all;
});
attempt("a sparse list is copied", () => [show(sparse(1, 2).slice()), show([...sparse(1, 2)]), show(Array.from(sparse(1, 2))), show(sparse(1, 2).concat([3])), show(sparse(1, 2).map(n => n + 1)), show(sparse(1, 2).filter(() => true))]);
attempt("the copies are summed", () => [sum(sparse(1, 2).slice()), sum([...sparse(1, 2)]), sum(sparse(1, 2).filter(() => true))]);

export {};

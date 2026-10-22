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

type HasLength = { length: number };

function collect(first: number, second: number, third: number): IArguments {
  return arguments;
}

function collectAfterAStore(first: number, second: number): IArguments {
  first = 10;
  return arguments;
}

function storeThenRead(first: number, second: number): number[] {
  arguments[1] = 20;
  return [first, second, arguments.length];
}

function lengthOf(item: HasLength): number {
  return item.length;
}

function kindOf(item: HasLength): string {
  return typeof item;
}

function setLength(item: HasLength, size: number): number {
  item.length = size;
  return item.length;
}

function increment(item: HasLength): number {
  item.length++;
  return item.length;
}

function forget(item: { length?: number }): boolean {
  return delete item.length;
}

function sum(list: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function inspect(list: ArrayLike<number>): string[] {
  const lines: string[] = [];
  for (let i = 0; i <= list.length; i++) lines.push(i + " " + (i in list ? "present" : "absent") + " " + typeof list[i] + " " + show(list[i]));
  return lines;
}

function total(numbers: Iterable<number>): number {
  let sum = 0;
  for (const number of numbers) sum += number;
  return sum;
}

function countOwn(...values: number[]): number {
  return values.length;
}

function fewer(first: number, second?: number, third?: number): unknown[] {
  return [arguments.length, first, second, third, 1 in arguments, arguments[1]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += lengthOf({ length: i }) + kindOf({ length: i }).length + setLength({ length: i }, 1) + increment({ length: i }) + sum([i, 1]) + inspect([i]).length + total([i]);
console.log("after 2000 honest values", warm);

attempt("length", () => lengthOf(collect(1, 2.5, -0)));
attempt("typeof", () => kindOf(collect(1, 2.5, -0)));
attempt("sum", () => sum(collect(1, 2.5, -0)));
attempt("elements", () => inspect(collect(1, 2.5, -0)));
attempt("for-of", () => total(collect(1, 2.5, -0)));
attempt("spread", () => [...collect(1, 2.5, -0)]);
attempt("spread as arguments", () => countOwn(...collect(1, 2.5, -0)));
attempt("Array.from", () => Array.from(collect(1, 2.5, -0)));
attempt("isArray", () => Array.isArray(collect(1, 2.5, -0)));
attempt("tag", () => Object.prototype.toString.call(collect(1, 2.5, -0)));
attempt("keys", () => Object.keys(collect(1, 2.5, -0)));
attempt("JSON", () => JSON.stringify(collect(1, 2.5, -0)));
attempt("store 2 to the length", () => {
  const made = collect(1, 2.5, -0);
  return [setLength(made, 2), sum(made), Object.keys(made), made[2]];
});
attempt("length++", () => increment(collect(1, 2.5, -0)));
attempt("delete the length", () => {
  const made = collect(1, 2.5, -0);
  return [forget(made), made.length, "length" in made];
});
attempt("a parameter is stored to before", () => {
  const made = collectAfterAStore(1, 2);
  return [made[0], made[1], made.length];
});
attempt("an element is stored to", () => storeThenRead(1, 2));
attempt("fewer arguments than parameters", () => [fewer(1), fewer(1, 2), fewer(1, undefined, 3)]);
attempt("honest again", () => [lengthOf({ length: 1 }), sum([1, 2])]);

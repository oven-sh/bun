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

function add<T>(list: T[], item: T): number {
  return list.push(item);
}

function put<T>(list: T[], index: number, item: T): void {
  list[index] = item;
}

function fillAll<T>(list: T[], item: T): T[] {
  return list.fill(item);
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function product(numbers: number[]): number {
  let total = 1;
  for (const n of numbers) total *= n;
  return total;
}

function report(title: string, numbers: number[]): void {
  console.log(title + ": " + show(numbers) + " " + numbers.map(n => typeof n).join());
  attempt("  sum", () => sum(numbers));
  attempt("  product", () => product(numbers));
  attempt("  each | 0", () => numbers.map(n => n | 0));
  attempt("  each toFixed", () => numbers.map(n => n.toFixed(1)));
  attempt("  largest", () => Math.max(...numbers));
  attempt("  includes 2", () => numbers.includes(2));
  attempt("  sorted", () => numbers.toSorted((a, b) => a - b));
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const list = [i];
  add(list, 1);
  put(list, 0, 2);
  total += sum(list) + product(fillAll([0, 0], i));
}
console.log("2000 honest rounds: " + total);

const integers = [1, 2, 3];
add<number | string>(integers, "4");
report("a string is pushed among integers", integers);

const fractions = [0.5, 1.5];
put<number | string>(fractions, 0, "half");
report("a string is stored among fractions", fractions);

const nulls = [1, 2];
add<number | null>(nulls, null);
report("null is pushed", nulls);

const blanks = [1.5, 2];
add<number | undefined>(blanks, undefined);
report("undefined is pushed", blanks);

const objects = [1, 2];
add<number | { valueOf(): number }>(objects, { valueOf: () => 40 });
report("an object with valueOf is pushed", objects);

const bigs = [1, 2];
add<number | bigint>(bigs, 3n);
report("a big integer is pushed", bigs);

const filled = [1, 2, 3];
fillAll<number | string>(filled, "x");
report("filled with a string", filled);

const flags = [1, 0];
add<number | boolean>(flags, true);
report("true is pushed", flags);

export {};

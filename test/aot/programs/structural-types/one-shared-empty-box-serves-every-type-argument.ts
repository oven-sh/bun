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

class Box<T> {
  static readonly EMPTY: Box<never> = new Box<never>();
  value: T | undefined = undefined;
  static empty<T>(): Box<T> {
    return Box.EMPTY;
  }
  fill(value: T): this {
    this.value = value;
    return this;
  }
}

function plusOne(box: Box<number>): number {
  return box.value === undefined ? -1 : box.value + 1;
}

function shout(box: Box<string>): string {
  return box.value === undefined ? "nothing" : box.value.toUpperCase();
}

function run(box: Box<() => number>): number {
  return box.value === undefined ? -1 : box.value();
}

function first(box: Box<number[]>): number {
  return box.value === undefined ? -1 : box.value[0] + box.value.length;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += plusOne(new Box<number>().fill(i)) + shout(new Box<string>().fill("s" + i)).length + run(new Box<() => number>().fill(() => i)) + first(new Box<number[]>().fill([i]));
console.log("2000 honest rounds: " + total);

const numbers = Box.empty<number>();
const strings = Box.empty<string>();
const functions = Box.empty<() => number>();
const lists = Box.empty<number[]>();
console.log("one object: " + (Object.is(numbers, strings) && Object.is(strings, functions) && Object.is(functions, lists)));

function report(title: string): void {
  console.log(title + ": " + typeof numbers.value + ", " + JSON.stringify(numbers) + ", keys " + Object.keys(strings).join());
  attempt("  as a number", () => plusOne(numbers));
  attempt("  as a string", () => shout(strings));
  attempt("  as a function", () => run(functions));
  attempt("  as a list", () => first(lists));
}

report("empty");
numbers.fill(41);
report("filled with a number");
numbers.fill(0.5);
report("filled with a fraction");
strings.fill("text");
report("filled with a string");
functions.fill(() => 9);
report("filled with a function");
lists.fill([5, 6]);
report("filled with a list");
numbers.value = undefined;
report("empty again");

export {};

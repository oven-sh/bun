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

class Lists {
  static readonly NONE: never[] = [];
  static none<T>(): T[] {
    return Lists.NONE;
  }
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function widths(strings: string[]): number {
  let total = 0;
  for (const s of strings) total += s.length;
  return total;
}

function glue(strings: string[]): string {
  let text = "";
  for (let i = 0; i < strings.length; i++) text += strings[i].toUpperCase();
  return text;
}

function runAll(functions: (() => number)[]): number {
  let total = 0;
  for (const f of functions) total += f();
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum([i, 1]) + widths(["a", "bc"]) + glue(["x"]).length + runAll([() => i]);
console.log("2000 honest rounds: " + warm);

const numbers = Lists.none<number>();
const strings = Lists.none<string>();
const functions = Lists.none<() => number>();
console.log("one array: " + (Object.is(numbers, strings) && Object.is(strings, functions)));

function report(title: string): void {
  console.log(title + ": " + show(numbers) + " length " + strings.length);
  attempt("  a sum", () => sum(numbers));
  attempt("  widths", () => widths(strings));
  attempt("  glued", () => glue(strings));
  attempt("  all run", () => runAll(functions));
  attempt("  numbers[0] + 1", () => numbers[0] + 1);
  attempt("  typeof strings[0]", () => typeof strings[0]);
}

report("empty");
numbers.push(1, 2);
report("two integers");
numbers.push(0.5);
report("and a fraction");
strings.push("text");
report("and a string");
functions.push(() => 4);
report("and a function");
numbers.length = 0;
report("emptied");
strings.push("only", "strings");
report("two strings");
strings.length = 0;
functions.push(() => 1, () => 2);
report("two functions");

export {};

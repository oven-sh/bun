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

function atLength<T>(list: T[]): T {
  return list[list.length];
}

function atMinusOne<T>(list: T[]): T {
  return list[-1];
}

function last<T>(list: T[]): T {
  return list[list.length - 1];
}

function append<T>(list: T[], item: T): void {
  list[list.length] = item;
}

function storeAtMinusOne<T>(list: T[], item: T): void {
  list[-1] = item;
}

function lastNumber(numbers: number[]): number {
  return numbers[numbers.length - 1] + 1;
}

function lastText(strings: string[]): number {
  return strings[strings.length - 1].length;
}

function state(list: unknown[]): string {
  return show(list) + " length " + list.length + " keys " + Object.keys(list).join();
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const list = [i];
  append(list, 1);
  total += last(list) + lastNumber(list) + lastText(["a", "bc"]);
}
console.log("2000 honest rounds: " + total);

attempt("numbers[length]", () => [typeof atLength([1, 2]), atLength([1, 2]) + 1, atLength([0.5]) * 2, atLength([1, 2]) | 0]);
attempt("numbers[-1]", () => [typeof atMinusOne([1, 2]), atMinusOne([1, 2]) + 1]);
attempt("strings[length]", () => [typeof atLength(["a"]), atLength(["a"]) + "!"]);
attempt("strings[length].length", () => atLength(["a"]).length);
attempt("strings[-1].length", () => atMinusOne(["a"]).length);
attempt("points[length].x", () => atLength([new Point(1)]).x);
attempt("points[-1].x", () => atMinusOne([new Point(1)]).x);
attempt("functions[length]()", () => atLength([() => 1])());
attempt("functions[-1]()", () => atMinusOne([() => 1])());
attempt("the last of an empty list", () => [typeof last<number>([]), last<number>([]) + 1, lastNumber([])]);
attempt("the last of an empty list of strings", () => lastText([]));
attempt("the last of an empty list of points", () => last<Point>([]).x);
attempt("the last of an empty list of functions", () => last<() => number>([])());

attempt("a store at the length appends", () => {
  const numbers = [1, 2];
  append(numbers, 3);
  append(numbers, 0.5);
  return [state(numbers), lastNumber(numbers)];
});
attempt("a store at the length of an empty list", () => {
  const strings: string[] = [];
  append(strings, "a");
  append(strings, "b");
  return [state(strings), lastText(strings)];
});
attempt("a store at minus one is no element", () => {
  const numbers = [1, 2];
  storeAtMinusOne(numbers, 9);
  return [state(numbers), atMinusOne(numbers), last(numbers), JSON.stringify(numbers), numbers.reduce((a, b) => a + b, 0), numbers.at(-1), numbers.indexOf(9), numbers.includes(9)];
});
attempt("then it is read by every list's [-1]? no", () => [typeof atMinusOne([1, 2]), typeof atMinusOne(["a"])]);
attempt("a store at minus one of strings", () => {
  const strings = ["a"];
  storeAtMinusOne(strings, "minus");
  return [state(strings), atMinusOne(strings).length, strings.join()];
});
attempt("written out", () => {
  const numbers = [1, 2];
  numbers[numbers.length] = 3;
  numbers[-1] = 4;
  const past = numbers[numbers.length];
  return [state(numbers), numbers[-1], typeof past, numbers[numbers.length - 1]];
});
attempt("a frozen list", () => {
  const numbers: number[] = [1, 2];
  Object.freeze(numbers);
  append(numbers, 3);
  return state(numbers);
});
attempt("a list that cannot grow", () => {
  const numbers: number[] = [1, 2];
  Object.preventExtensions(numbers);
  storeAtMinusOne(numbers, 3);
  return state(numbers);
});

export {};

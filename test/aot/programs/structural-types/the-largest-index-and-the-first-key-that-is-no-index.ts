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

const LARGEST = 2 ** 32 - 2;
const FIRST_KEY = 2 ** 32 - 1;

function state(list: unknown[]): string {
  return "length " + list.length + ", keys " + Object.keys(list).join();
}

function put<T>(list: T[], index: number, item: T): void {
  list[index] = item;
}

function get<T>(list: T[], index: number): T {
  return list[index];
}

attempt("a store at the largest index", () => {
  const numbers = [1, 2];
  put(numbers, LARGEST, 3);
  return [state(numbers), get(numbers, LARGEST), get(numbers, LARGEST) + 1, typeof get(numbers, LARGEST - 1), numbers.at(-1), numbers[numbers.length - 1]];
});
attempt("a store at the first key that is no index", () => {
  const numbers = [1, 2];
  put(numbers, FIRST_KEY, 3);
  return [state(numbers), get(numbers, FIRST_KEY), numbers.at(-1), JSON.stringify(numbers)];
});
attempt("a store at 2 ** 32", () => {
  const numbers = [1, 2];
  put(numbers, 2 ** 32, 3);
  return [state(numbers), get(numbers, 2 ** 32), get(numbers, 0)];
});
attempt("a store at 2 ** 53", () => {
  const numbers = [1, 2];
  put(numbers, 2 ** 53, 3);
  return [state(numbers), get(numbers, 2 ** 53), get(numbers, 2 ** 53 + 1)];
});
attempt("a push onto the longest list", () => {
  const numbers: number[] = [];
  numbers.length = FIRST_KEY;
  try {
    numbers.push(7);
  } catch (error) {
    return ["threw " + (error instanceof RangeError), state(numbers), get(numbers, FIRST_KEY)];
  }
  return "did not throw";
});
attempt("a push of two onto a list one short of the longest", () => {
  const numbers: number[] = [];
  numbers.length = LARGEST;
  try {
    numbers.push(7, 8);
  } catch (error) {
    return ["threw " + (error instanceof RangeError), state(numbers)];
  }
  return "did not throw";
});
attempt("a pop off the longest list", () => {
  const numbers: number[] = [];
  numbers.length = FIRST_KEY;
  return [numbers.pop(), state(numbers)];
});
attempt("the length is cut after a far store", () => {
  const strings = ["a"];
  put(strings, LARGEST, "z");
  strings.length = 2;
  return [state(strings), show(strings), typeof strings[1]];
});
attempt("far stores of four kinds", () => {
  const strings = ["a"];
  const functions = [() => 1];
  const fractions = [0.5];
  const lists = [[1]];
  put(strings, 100000, "z");
  put(functions, 100000, () => 2);
  put(fractions, 100000, 1.5);
  put(lists, 100000, [2]);
  return [state(strings), get(strings, 100000).toUpperCase(), typeof get(strings, 5), get(functions, 100000)(), typeof get(functions, 5), get(fractions, 100000) + get(fractions, 0), typeof get(fractions, 5), get(lists, 100000)[0]];
});
attempt("far stores: a method of what is missing", () => {
  const strings = ["a"];
  put(strings, 100000, "z");
  return get(strings, 5).toUpperCase();
});
attempt("far stores: what is missing is called", () => {
  const functions = [() => 1];
  put(functions, 100000, () => 2);
  return get(functions, 5)();
});
attempt("far stores: a sum over what is there", () => {
  const numbers = [1];
  put(numbers, 100000, 2);
  let sum = 0;
  numbers.forEach(n => (sum += n));
  return [sum, numbers.reduce((a, b) => a + b, 0), numbers.indexOf(2), numbers.lastIndexOf(1), numbers.includes(2), numbers.findIndex(n => n === undefined)];
});
attempt("written out", () => {
  const numbers = [1];
  numbers[4294967294] = 2;
  numbers[4294967295] = 3;
  numbers[4294967296] = 4;
  return [state(numbers), numbers[4294967294], numbers[4294967295], numbers[4294967296]];
});
attempt("an index from an unsigned shift", () => {
  const numbers = [1, 2];
  const minusOne: number = -1;
  const minusTwo: number = -2;
  put(numbers, minusOne >>> 0, 3);
  put(numbers, minusTwo >>> 0, 4);
  return [state(numbers), get(numbers, minusOne >>> 0), get(numbers, minusTwo >>> 0), typeof get(numbers, minusOne)];
});

export {};

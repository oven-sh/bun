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

function inspect(numbers: number[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    const exact = Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : Object.is(value, -0) ? "minus zero" : Object.is(value, NaN) ? "not a number" : String(value);
    lines.push(i + " " + (i in numbers ? "present" : "absent") + " " + typeof value + " " + exact);
  }
  return lines;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(number => number * 2);
}

function doubledByHand(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] * 2);
  return result;
}

function report(name: string, make: () => number[]): void {
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": length", () => make().length);
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": sum as integers", () => sumAsIntegers(make()));
  attempt(name + ": map", () => doubled(make()));
  attempt(name + ": doubled by hand", () => doubledByHand(make()));
  attempt(name + ": the first, fixed", () => make()[0].toFixed(1));
  attempt(name + ": after a push", () => {
    const numbers = make();
    const length = numbers.push(7);
    return [length, inspect(numbers), sum(numbers)];
  });
  attempt(name + ": after a store at 1", () => {
    const numbers = make();
    numbers[1] = 1.5;
    return [inspect(numbers), sum(numbers)];
  });
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const dense of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += inspect(dense).length + sum(dense) + sumByForOf(dense) + sumAsIntegers(dense) + doubled(dense)[0] + doubledByHand(dense)[1];
  }
}
console.log("after 4000 dense arrays", warm);

function fromLength(length: number): number[] {
  return Array.from({ length }, (_, i) => i);
}

function fromLengthAlone(length: number): unknown[] {
  return Array.from({ length });
}

const lengths: [string, number][] = [
  ["3", 3],
  ["0", 0],
  ["-0", -0],
  ["-1", -1],
  ["2.7", 2.7],
  ["0.9", 0.9],
  ["NaN", NaN],
  ["-Infinity", -Infinity],
  ["2 ** 32", 2 ** 32],
  ["2 ** 53", 2 ** 53],
  ["Infinity", Infinity],
];
for (const [name, length] of lengths) {
  attempt("length " + name + " with a map function", () => inspect(fromLength(length)));
  attempt("length " + name + " alone", () => fromLengthAlone(length).length);
}

const log: string[] = [];
attempt("a length behind a getter", () => {
  const like: ArrayLike<number> = {
    get length() {
      log.push("length");
      return 2;
    },
    0: 1,
    1: 2,
  };
  return [Array.from(like), sum(Array.from(like))];
});
console.log("reads of the length", log.length);
attempt("elements behind getters", () => {
  const order: number[] = [];
  const like: ArrayLike<number> = {
    length: 2,
    get 0() {
      order.push(0);
      return 10;
    },
    get 1() {
      order.push(1);
      return 20;
    },
  };
  return [Array.from(like, value => value + 1), order];
});
attempt("iterable and array-like: the iterator wins", () => {
  const both: ArrayLike<number> & Iterable<number> = {
    0: 1,
    length: 1,
    *[Symbol.iterator]() {
      yield 100;
      yield 200;
    },
  };
  return inspect(Array.from(both));
});
attempt("a function as the array-like", () => {
  const like: { length: number } = (a: number, b: number) => a + b;
  return Array.from(like).length;
});
attempt("a string as the array-like", () => {
  const like: { length: number } = "abc";
  return Array.from(like);
});
attempt("a typed array", () => inspect(Array.from(new Float32Array([0.5, -0, NaN]))));
attempt("an array with holes", () => inspect(Array.from(new Array<number>(2))));
attempt("a length that the map function changes", () => {
  const like = { length: 3 };
  return inspect(Array.from(like, (_, i) => {
    like.length = 1;
    return i;
  }));
});

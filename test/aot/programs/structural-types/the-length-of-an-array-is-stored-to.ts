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

function setLength(numbers: number[], length: number): number {
  numbers.length = length;
  return numbers.length;
}

function truncateWhileSumming(numbers: number[], at: number, length: number): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    if (i === at) numbers.length = length;
    total += numbers[i];
  }
  return total;
}

function cachedLength(numbers: number[], at: number, length: number): number {
  let total = 0;
  for (let i = 0, n = numbers.length; i < n; i++) {
    if (i === at) numbers.length = length;
    total += numbers[i];
  }
  return total;
}

for (const length of [0, 1, 3, 5]) {
  report("integers, length = " + length, () => {
    const numbers = [1, 2, 3];
    setLength(numbers, length);
    return numbers;
  });
}
report("doubles, length = 5", () => {
  const numbers = [1.5, 2.5, 3.5];
  setLength(numbers, 5);
  return numbers;
});

const lengths: [string, number][] = [
  ["-1", -1],
  ["1.5", 1.5],
  ["NaN", NaN],
  ["-0", -0],
  ["2 ** 32 - 1", 2 ** 32 - 1],
  ["2 ** 32", 2 ** 32],
  ["Infinity", Infinity],
];
for (const [name, length] of lengths) attempt("length = " + name, () => setLength([1, 2, 3], length));
attempt("length += 2", () => {
  const numbers = [1];
  numbers.length += 2;
  return inspect(numbers);
});
attempt("length--", () => {
  const numbers = [1, 2, 3];
  numbers.length--;
  return inspect(numbers);
});
attempt("cut short during a loop", () => truncateWhileSumming([1, 2, 3, 4, 5], 1, 3));
attempt("emptied during a loop", () => truncateWhileSumming([1, 2, 3, 4, 5], 1, 0));
attempt("made longer during a loop", () => truncateWhileSumming([1, 2, 3], 1, 5));
attempt("cut short during a loop that cached the length", () => cachedLength([1, 2, 3, 4, 5], 1, 3));
attempt("emptied during a loop that cached the length", () => cachedLength([1.5, 2.5, 3.5], 0, 0));
attempt("cut short and refilled", () => {
  const numbers = [1, 2, 3];
  numbers.length = 0;
  numbers.push(9);
  return [inspect(numbers), numbers[1], numbers[2]];
});
attempt("a frozen length", () => {
  const numbers = [1, 2, 3];
  Object.defineProperty(numbers, "length", { writable: false });
  const results: unknown[] = [];
  for (const change of [() => numbers.push(4), () => numbers.pop(), () => setLength(numbers, 1), () => (numbers[5] = 1), () => (numbers[0] = 10)]) {
    try {
      results.push(change());
    } catch (error) {
      results.push(error instanceof Error ? error.constructor.name : "?");
    }
  }
  return [results, inspect(numbers)];
});

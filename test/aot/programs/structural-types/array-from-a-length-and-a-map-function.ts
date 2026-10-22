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

report("index", () => Array.from({ length: 3 }, (_, i) => i));
report("index / 2", () => Array.from({ length: 3 }, (_, i) => i / 2));
report("index * -1", () => Array.from({ length: 3 }, (_, i) => i * -1));
report("index - 1", () => Array.from({ length: 3 }, (_, i) => i - 1));
report("0 / index", () => Array.from({ length: 3 }, (_, i) => 0 / i));
report("2 ** 31 + index", () => Array.from({ length: 3 }, (_, i) => 2 ** 31 + i));
report("a constant", () => Array.from({ length: 3 }, () => 7));

function lookUp(table: number[], index: number): number {
  return table[index];
}
report("a function typed as returning a number that finds nothing", () => Array.from({ length: 3 }, (_, i) => lookUp([10, 20], i)));
report("from an array-like with a missing index", () => Array.from({ 0: 5, length: 3 } satisfies ArrayLike<number>, (value: number) => value));

attempt("what the map function gets", () => {
  const seen: string[] = [];
  Array.from({ length: 2 }, (value, index) => seen.push(typeof value + " " + index));
  return seen;
});
attempt("this of the map function", () => Array.from({ length: 2 }, function (this: { step: number }, _, i) { return i * this.step; }, { step: 10 }));
attempt("length 0", () => Array.from({ length: 0 }, (_, i) => i));
attempt("a length from a variable", () => {
  const results: number[][] = [];
  for (let length = 0; length < 4; length++) results.push(Array.from({ length }, (_, i) => i * length));
  return results;
});
attempt("nested", () => Array.from({ length: 2 }, (_, i) => Array.from({ length: 2 }, (_, j) => i * 2 + j)));
attempt("sum of nested", () => Array.from({ length: 3 }, (_, i) => sum(Array.from({ length: i }, (_, j) => j + 0.5))));
attempt("a large one", () => {
  const numbers = Array.from({ length: 5000 }, (_, i) => i);
  return [numbers.length, sum(numbers), numbers[4999], numbers[5000]];
});
attempt("the map function throws", () => Array.from({ length: 3 }, (_, i) => {
  if (i === 1) throw new RangeError("stop");
  return i;
}));

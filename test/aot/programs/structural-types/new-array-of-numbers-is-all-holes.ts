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

report("new Array<number>(3)", () => new Array<number>(3));
report("in a typed local", () => {
  const numbers: number[] = new Array<number>(3);
  return numbers;
});
report("a length from a variable", () => {
  const n = "abc".length;
  return new Array<number>(n);
});
report("half filled", () => {
  const numbers = new Array<number>(3);
  numbers[2] = 9;
  return numbers;
});
report("half filled with doubles", () => {
  const numbers = new Array<number>(3);
  numbers[0] = 0.5;
  return numbers;
});

function fillUp(numbers: number[]): number[] {
  for (let i = 0; i < numbers.length; i++) numbers[i] = i * i;
  return numbers;
}
report("filled by a loop", () => fillUp(new Array<number>(3)));

function accumulate(numbers: number[]): number[] {
  for (let i = 0; i < numbers.length; i++) numbers[i] += 1;
  return numbers;
}
function increment(numbers: number[]): number[] {
  for (let i = 0; i < numbers.length; i++) numbers[i]++;
  return numbers;
}
function orZero(numbers: number[]): number[] {
  for (let i = 0; i < numbers.length; i++) numbers[i] = numbers[i] || 0;
  return numbers;
}
function nullishZero(numbers: number[]): number[] {
  for (let i = 0; i < numbers.length; i++) numbers[i] ??= 0;
  return numbers;
}
attempt("+= 1 on every hole", () => inspect(accumulate(new Array<number>(3))));
attempt("++ on every hole", () => inspect(increment(new Array<number>(3))));
attempt("|| 0 on every hole", () => inspect(orZero(new Array<number>(3))));
attempt("??= 0 on every hole", () => inspect(nullishZero(new Array<number>(3))));
attempt("counting into holes", () => {
  const counts = new Array<number>(4);
  for (const digit of [1, 3, 3, 1, 1]) counts[digit] = (counts[digit] || 0) + 1;
  return inspect(counts);
});
attempt("compared", () => {
  const numbers = new Array<number>(1);
  return [numbers[0] === 0, numbers[0] == 0, numbers[0] < 1, numbers[0] > -1, numbers[0] === undefined, !numbers[0], numbers[0] !== numbers[0]];
});
attempt("in a field", () => {
  class Histogram {
    bins = new Array<number>(3);
    total(): number {
      return sum(this.bins);
    }
    first(): number {
      return this.bins[0];
    }
  }
  const histogram = new Histogram();
  return [histogram.total(), histogram.first(), 0 in histogram.bins, inspect(histogram.bins)];
});
attempt("captured", () => {
  const numbers = new Array<number>(2);
  const read = (index: number): number => numbers[index];
  const before = [read(0), read(1)];
  numbers[1] = 4;
  return [...before, read(0), read(1)];
});
attempt("a large one", () => {
  const numbers = new Array<number>(100000);
  return [numbers.length, numbers[0], numbers[99999], 50000 in numbers, sum(numbers)];
});

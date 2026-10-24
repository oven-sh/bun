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

function forOfWith(numbers: number[], change: (value: number, numbers: number[]) => void): unknown[] {
  const seen: unknown[] = [];
  for (const value of numbers) {
    seen.push(value);
    change(value, numbers);
    if (seen.length > 12) break;
  }
  return seen;
}

function forEachWith(numbers: number[], change: (value: number, numbers: number[]) => void): unknown[] {
  const seen: unknown[] = [];
  numbers.forEach(value => {
    seen.push(value);
    change(value, numbers);
  });
  return seen;
}

function mapWith(numbers: number[], change: (value: number, numbers: number[]) => void): number[] {
  return numbers.map(value => {
    change(value, numbers);
    return value * 2;
  });
}

function indexWith(numbers: number[], change: (value: number, numbers: number[]) => void): unknown[] {
  const seen: unknown[] = [];
  for (let i = 0; i < numbers.length && seen.length <= 12; i++) {
    seen.push(numbers[i]);
    change(numbers[i], numbers);
  }
  return seen;
}

const changes: [string, (value: number, numbers: number[]) => void][] = [
  ["nothing", () => {}],
  ["push while short", (_, numbers) => void (numbers.length < 6 && numbers.push(numbers.length * 10))],
  ["pop", (_, numbers) => void numbers.pop()],
  ["shift", (_, numbers) => void numbers.shift()],
  ["unshift once", (value, numbers) => void (value === 1 && numbers.unshift(0))],
  ["delete the last", (_, numbers) => void delete numbers[numbers.length - 1]],
  ["delete the next", (value, numbers) => void delete numbers[numbers.indexOf(value) + 1]],
  ["empty it", (_, numbers) => void (numbers.length = 0)],
  ["store a fraction ahead", (_, numbers) => void (numbers[numbers.length - 1] = 0.5)],
  ["reverse once", (value, numbers) => void (value === 1 && numbers.reverse())],
  ["sort descending once", (value, numbers) => void (value === 1 && numbers.sort((a, b) => b - a))],
  ["splice out the next", (value, numbers) => void numbers.splice(numbers.indexOf(value) + 1, 1)],
];

for (const [name, change] of changes) {
  attempt(name + ": for-of", () => forOfWith([1, 2, 3, 4], change));
  attempt(name + ": forEach", () => forEachWith([1, 2, 3, 4], change));
  attempt(name + ": map", () => inspect(mapWith([1, 2, 3, 4], change)));
  attempt(name + ": by index", () => indexWith([1, 2, 3, 4], change));
}
attempt("a sort whose comparator empties the array", () => {
  const numbers = [3, 1, 2];
  numbers.sort((a, b) => {
    numbers.length = 0;
    return a - b;
  });
  return inspect(numbers);
});
attempt("a reduce that pushes", () => {
  const numbers = [1, 2, 3];
  return [numbers.reduce((total, value) => (numbers.push(100), total + value), 0), numbers.length];
});
attempt("an iterator kept after the end", () => {
  const numbers = [1];
  const iterator = numbers[Symbol.iterator]();
  const steps = [iterator.next(), iterator.next()];
  numbers.push(2);
  steps.push(iterator.next());
  return steps.map(step => step.done + ":" + step.value);
});
attempt("a spread of an array whose getter grows it", () => {
  const numbers = [1, 2];
  Object.defineProperty(numbers, 0, {
    get() {
      if (numbers.length < 4) numbers.push(9);
      return 1;
    },
  });
  return [...numbers];
});

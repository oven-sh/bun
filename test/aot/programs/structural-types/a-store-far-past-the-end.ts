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

function storeAt(numbers: number[], index: number, value: number): number {
  numbers[index] = value;
  return numbers.length;
}

function present(numbers: number[]): string[] {
  const seen: string[] = [];
  for (const key in numbers) seen.push(key + "=" + numbers[key]);
  return seen;
}

function sumOfPresent(numbers: number[]): number {
  let total = 0;
  for (const key of Object.keys(numbers)) total += numbers[Number(key)];
  return total;
}

for (const index of [3, 4, 100, 10000, 1000000, 2 ** 31, 2 ** 32 - 2]) {
  attempt("a store at " + index + ": length and members", () => {
    const numbers = [1, 2, 3];
    return [storeAt(numbers, index, 9), present(numbers), sumOfPresent(numbers)];
  });
  attempt("a store at " + index + ": around it", () => {
    const numbers = [1.5, 2.5, 3.5];
    storeAt(numbers, index, 9.5);
    return [numbers[index], numbers[index - 1], numbers[index + 1], index - 1 in numbers, numbers[0], numbers[2]];
  });
}
for (const index of [2 ** 32 - 1, 2 ** 32, -1, 1.5]) {
  attempt("a store at " + index + " makes a member, not an element", () => {
    const numbers = [1, 2, 3];
    return [storeAt(numbers, index, 9), present(numbers), numbers[index]];
  });
}
report("sparse, then read from the start", () => {
  const numbers = [1, 2];
  numbers[1000000] = 3;
  numbers.length = 3;
  return numbers;
});
attempt("sparse: push, pop, indexOf", () => {
  const numbers: number[] = [];
  numbers[1000000] = 3;
  const length = numbers.push(4);
  return [length, numbers.indexOf(4), numbers.pop(), numbers.pop(), numbers.pop(), numbers.length];
});
attempt("sparse: sum of the first thousand", () => {
  const numbers: number[] = [];
  numbers[1000000] = 3;
  let total = 0;
  for (let i = 0; i < 1000; i++) total += numbers[i] ?? 1;
  return total;
});
attempt("filled backwards", () => {
  const numbers: number[] = [];
  for (let i = 9; i >= 0; i--) numbers[i] = i;
  return [numbers.length, sum(numbers), inspect(numbers).length];
});
attempt("every other index", () => {
  const numbers: number[] = [];
  for (let i = 0; i < 10; i += 2) numbers[i] = i + 0.5;
  return [inspect(numbers), sumOfPresent(numbers), sum(numbers)];
});

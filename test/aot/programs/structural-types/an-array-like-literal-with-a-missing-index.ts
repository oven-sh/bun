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

function inspectLike(list: ArrayLike<number>): string[] {
  const lines: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    lines.push(i + " " + (i in list ? "present" : "absent") + " " + typeof value + " " + (Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : String(value)));
  }
  return lines;
}

function sumLike(list: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function lastLike(list: ArrayLike<number>): number {
  return list[list.length - 1];
}

function lastTimesTwo(list: ArrayLike<number>): number {
  return list[list.length - 1] * 2;
}

for (let i = 0; i < 2000; i++) warm += sumLike([i, 2, 3]) + lastLike([i, 2, 3]) + lastTimesTwo([i]) + inspectLike([i]).length;
console.log("after 2000 more arrays", warm);

const a: ArrayLike<number> = { 0: 123, 1: 456, length: 3 };
attempt("a[2]", () => a[2]);
attempt("typeof a[2]", () => typeof a[2]);
attempt("2 in a", () => 2 in a);
attempt("a[2] + 1", () => a[2] + 1);
attempt("a[2] | 0", () => a[2] | 0);
attempt("a[2].toFixed", () => a[2].toFixed(1));
attempt("elements", () => inspectLike(a));
attempt("sum", () => sumLike(a));
attempt("last", () => lastLike(a));
attempt("last * 2", () => lastTimesTwo(a));
attempt("isArray", () => Array.isArray(a));
attempt("keys", () => Object.keys(a));
attempt("JSON", () => JSON.stringify(a));
attempt("an array again", () => [sumLike([1, 2, 3]), lastLike([1, 2, 3])]);

report("Array.from(a)", () => Array.from(a));
report("Array.prototype.slice.call(a)", () => Array.prototype.slice.call(a));
report("Array.from(a, identity)", () => Array.from(a, value => value));
attempt("Array.from(a, double)", () => inspect(Array.from(a, value => value * 2)));
attempt("computed keys", () => {
  const b: ArrayLike<number> = { [0]: 123, [1]: 456, length: 3 };
  return [inspectLike(b), sumLike(b)];
});
attempt("the first index is missing", () => {
  const b: ArrayLike<number> = { 1: 456, 2: 789, length: 3 };
  return [inspectLike(b), sumLike(b), inspect(Array.from(b))];
});
attempt("no index at all", () => {
  const b: ArrayLike<number> = { length: 2 };
  return [inspectLike(b), sumLike(b), inspect(Array.from(b))];
});
attempt("more indexes than the length", () => {
  const b: ArrayLike<number> = { 0: 1, 1: 2, 2: 3, length: 2 };
  return [inspectLike(b), sumLike(b), inspect(Array.from(b))];
});
attempt("in a field", () => {
  class Holder {
    constructor(public list: ArrayLike<number>) {}
    total(): number {
      return sumLike(this.list) + this.list[2];
    }
  }
  return [new Holder([1, 2, 3]).total(), new Holder(a).total()];
});

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

function mean(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total / numbers.length;
}

function firstPlusLast(numbers: number[]): number {
  return numbers[0] + numbers[numbers.length - 1];
}

function denseCallerOne(): number {
  return mean([1, 2, 3]) + firstPlusLast([1, 2, 3]);
}
function denseCallerTwo(): number {
  return mean([0.5, 1.5]) + firstPlusLast([0.5, 1.5]);
}
function denseCallerThree(n: number): number {
  const numbers: number[] = [];
  for (let i = 0; i <= n; i++) numbers.push(i);
  return mean(numbers) + firstPlusLast(numbers);
}
function holeyCaller(): number[] {
  return [mean(new Array<number>(3)), firstPlusLast(new Array<number>(3))];
}
function fromCaller(): number[] {
  return [mean(Array.from<number>({ length: 3 })), firstPlusLast(Array.from<number>({ length: 3 }))];
}
function emptyCaller(): number[] {
  return [mean([]), firstPlusLast([])];
}
function partlyHoleyCaller(): number[] {
  const numbers = [1, 2, 3];
  delete numbers[2];
  return [mean(numbers), firstPlusLast(numbers)];
}

const table = { mean, firstPlusLast };

attempt("the holey caller comes first", holeyCaller);
for (let i = 0; i < 2000; i++) warm += denseCallerOne() + denseCallerTwo() + denseCallerThree(i & 3);
console.log("after 6000 dense calls", warm);

attempt("holes", holeyCaller);
attempt("undefined from Array.from", fromCaller);
attempt("empty", emptyCaller);
attempt("one hole at the end", partlyHoleyCaller);
attempt("dense again", () => denseCallerOne() + denseCallerTwo() + denseCallerThree(2));
attempt("call", () => [mean.call(undefined, new Array<number>(2)), mean.call(undefined, [1, 2])]);
attempt("apply", () => [mean.apply(undefined, [new Array<number>(2)]), mean.apply(undefined, [[1, 2]])]);
attempt("bind", () => [mean.bind(undefined, new Array<number>(2))(), mean.bind(undefined, [1, 2])()]);
attempt("handed to map", () => [[1, 2], new Array<number>(2), [3.5]].map(mean));
attempt("read from a literal", () => [table.mean(new Array<number>(2)), table.firstPlusLast(new Array<number>(2)), table.mean([4])]);
attempt("an array that loses an element between two calls", () => {
  const numbers = [1, 2, 3];
  const before = mean(numbers);
  delete numbers[1];
  const between = mean(numbers);
  numbers[1] = 2;
  return [before, between, mean(numbers)];
});
attempt("dense at the end", () => denseCallerOne() + denseCallerTwo() + denseCallerThree(2));

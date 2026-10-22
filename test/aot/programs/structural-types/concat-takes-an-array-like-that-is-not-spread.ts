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

function fake(): ConcatArray<number> {
  return {
    length: 2,
    0: 5,
    1: 6,
    join: () => "5,6",
    slice: () => [5, 6],
  };
}

function spreadable(): ConcatArray<number> {
  return Object.assign(fake(), { [Symbol.isConcatSpreadable]: true });
}

function tooShort(): ConcatArray<number> {
  return Object.assign({ length: 3, 0: 5, join: () => "5", slice: () => [5] }, { [Symbol.isConcatSpreadable]: true });
}

function notSpreadable(): number[] {
  return Object.assign([5, 6], { [Symbol.isConcatSpreadable]: false });
}

function joinOn(numbers: number[], more: ConcatArray<number>): number[] {
  return numbers.concat(more);
}

for (let i = 0; i < 2000; i++) warm += joinOn([i], [2, 3]).length + sum(joinOn([i], [0.5]));
console.log("after 2000 honest concatenations", warm);

report("an array", () => joinOn([1], [5, 6]));
report("an object that only looks like one", () => joinOn([1], fake()));
report("the same, marked as spreadable", () => joinOn([1], spreadable()));
report("spreadable and too short", () => joinOn([1], tooShort()));
report("an array marked as not spreadable", () => joinOn([1], notSpreadable()));
report("an array with holes", () => joinOn([1], new Array<number>(2)));
attempt("what the element really is", () => {
  const joined = joinOn([1], fake());
  return [joined.length, typeof joined[1], joined[1] === undefined, Array.isArray(joined[1])];
});
attempt("the receiver is marked as not spreadable", () => {
  const joined = notSpreadable().concat([7]);
  return [joined.length, typeof joined[0], joined[1]];
});
attempt("a readonly array", () => {
  const fixed: readonly number[] = [5, 6];
  return inspect(joinOn([1], fixed));
});
attempt("a subclass", () => {
  class List extends Array<number> {}
  const joined = joinOn(List.from([1]), List.from([2]));
  return [joined.constructor.name, inspect(joined)];
});

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

function inspectUnknown(list: unknown[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < list.length; i++) lines.push(i + " " + (i in list ? "present" : "absent") + " " + typeof list[i] + " " + Object.is(list[i], undefined));
  return lines;
}

function countNumbers(list: unknown[]): number {
  let count = 0;
  for (const item of list) if (typeof item === "number") count++;
  return count;
}

function numbersOnly(list: unknown[]): number[] {
  return list.filter(item => typeof item === "number");
}

const made = Array.from({ length: 3 });
attempt("elements", () => inspectUnknown(made));
attempt("length", () => made.length);
attempt("keys", () => Object.keys(made));
attempt("JSON", () => JSON.stringify(made));
attempt("numbers in it", () => countNumbers(made));
attempt("only the numbers", () => numbersOnly(made));
attempt("map to the index", () => inspect(Array.from({ length: 3 }).map((_, i) => i)));
attempt("forEach visits", () => {
  let visits = 0;
  Array.from({ length: 3 }).forEach(() => visits++);
  return visits;
});
attempt("against holes", () => {
  let visits = 0;
  new Array<unknown>(3).forEach(() => visits++);
  return [visits, 0 in Array.from({ length: 3 }), 0 in new Array<unknown>(3)];
});
attempt("includes and indexOf undefined", () => [made.includes(undefined), made.indexOf(undefined), new Array<unknown>(3).includes(undefined), new Array<unknown>(3).indexOf(undefined)]);
attempt("numbers stored afterwards", () => {
  const list = Array.from({ length: 3 });
  list[0] = 1;
  list[2] = 2.5;
  return [inspectUnknown(list), countNumbers(list), sum(numbersOnly(list))];
});
attempt("pushed afterwards", () => {
  const list = Array.from({ length: 2 });
  list.push(1, "two", null);
  return inspectUnknown(list);
});
attempt("sorted", () => inspectUnknown(Array.from({ length: 2 }).concat([3, 1]).sort()));
attempt("joined", () => made.join("-"));
attempt("typed as possibly undefined numbers", () => {
  const list: (number | undefined)[] = Array.from<undefined>({ length: 3 });
  list[1] = 5;
  let total = 0;
  for (const item of list) total += item ?? 100;
  return total;
});
attempt("typed as numbers by a type argument", () => inspect(Array.from<number>({ length: 3 })));
report("Array.from<number>({ length: 3 })", () => Array.from<number>({ length: 3 }));
attempt("keys()", () => inspect([...Array.from({ length: 3 }).keys()]));
attempt("a spread of holes", () => inspectUnknown([...new Array<unknown>(2)]));

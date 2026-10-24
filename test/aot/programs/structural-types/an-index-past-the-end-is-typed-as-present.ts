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

function at(numbers: number[], index: number): number {
  return numbers[index];
}

function plusOne(numbers: number[], index: number): number {
  return numbers[index] + 1;
}

function asInteger(numbers: number[], index: number): number {
  return numbers[index] | 0;
}

function fixed(numbers: number[], index: number): string {
  return numbers[index].toFixed(1);
}

function kind(numbers: number[], index: number): string {
  return typeof numbers[index];
}

function isThere(numbers: number[], index: number): boolean {
  return index in numbers;
}

function oneTooFar(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i <= numbers.length; i++) total += numbers[i];
  return total;
}

function fromTheBack(numbers: number[]): number {
  let total = 0;
  for (let i = numbers.length - 1; i >= -1; i--) total += numbers[i];
  return total;
}

function neighbors(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i - 1] + numbers[i + 1]);
  return result;
}

function letterAt(text: string, index: number): string {
  return text[index];
}

function letterLength(text: string, index: number): number {
  return text[index].length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const numbers = i % 2 === 0 ? [i, 2, 3] : [i + 0.5, 2.5, 3.5];
  warm += at(numbers, 1) + plusOne(numbers, 2) + asInteger(numbers, 0) + fixed(numbers, 1).length + kind(numbers, 1).length + (isThere(numbers, 1) ? 1 : 0);
  warm += letterAt("abc", i % 3).length + letterLength("abc", i % 3);
}
console.log("after 2000 reads inside the bounds", warm);

const indexes: [string, number][] = [
  ["1", 1],
  ["3", 3],
  ["10", 10],
  ["-1", -1],
  ["1.5", 1.5],
  ["NaN", NaN],
  ["-0", -0],
  ["Infinity", Infinity],
  ["2 ** 31", 2 ** 31],
  ["2 ** 32 - 1", 2 ** 32 - 1],
  ["2 ** 32", 2 ** 32],
  ["-(2 ** 31)", -(2 ** 31)],
];
for (const [start, make] of [["integers", () => [1, 2, 3]], ["doubles", () => [1.5, 2.5, 3.5]]] satisfies [string, () => number[]][]) {
  for (const [name, index] of indexes) {
    attempt(start + "[" + name + "]", () => [at(make(), index), kind(make(), index), isThere(make(), index), plusOne(make(), index), asInteger(make(), index)]);
    attempt(start + "[" + name + "].toFixed", () => fixed(make(), index));
  }
  attempt(start + ": a loop that goes one too far", () => oneTooFar(make()));
  attempt(start + ": a loop that goes below zero", () => fromTheBack(make()));
  attempt(start + ": neighbors", () => neighbors(make()));
  attempt(start + ": constant indexes", () => {
    const numbers = make();
    return [numbers[3], numbers[10], numbers[-1], numbers[3] + 1, typeof numbers[3]];
  });
  attempt(start + ": a member under a fractional key", () => {
    const numbers = make();
    numbers[1.5] = 99;
    numbers[-1] = 98;
    return [at(numbers, 1.5), at(numbers, -1), numbers.length, Object.keys(numbers)];
  });
}
attempt("an empty array", () => [at([], 0), plusOne([], 0), kind([], 0), oneTooFar([])]);
for (const [name, index] of indexes) attempt("text[" + name + "]", () => [letterAt("abc", index), typeof letterAt("abc", index)]);
attempt("the length of a letter past the end", () => letterLength("abc", 3));
attempt("a pop from an empty array is honest about it", () => {
  const numbers: number[] = [];
  return [numbers.pop(), numbers.shift(), numbers.at(0)];
});

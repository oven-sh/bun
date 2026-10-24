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

const log: string[] = [];

function put<T>(list: (number | T)[], index: number, value: T): void {
  list[index] = value;
}

const visitors: [string, (numbers: number[]) => void][] = [
  ["undefined", numbers => put(numbers, 1, undefined)],
  ["null", numbers => put(numbers, 1, null)],
  ["true", numbers => put(numbers, 1, true)],
  ["false", numbers => put(numbers, 1, false)],
  ["a bigint", numbers => put(numbers, 1, 5n)],
  ["a symbol", numbers => put(numbers, 1, Symbol("s"))],
  ["the text 5", numbers => put(numbers, 1, "5")],
  ["an object with valueOf", numbers => put(numbers, 1, { valueOf: () => (log.push("valueOf"), 5) })],
  ["an object with toString", numbers => put(numbers, 1, { toString: () => (log.push("toString"), "5") })],
  ["an array", numbers => put(numbers, 1, [5])],
  ["a date", numbers => put(numbers, 1, new Date(5))],
  ["a Number object", numbers => put(numbers, 1, new Number(5))],
  ["NaN, which is honest", numbers => put(numbers, 1, NaN)],
  ["-0, which is honest", numbers => put(numbers, 1, -0)],
];

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function product(numbers: number[]): number {
  let total = 1;
  for (const number of numbers) total *= number;
  return total;
}

function second(numbers: number[]): number {
  return numbers[1];
}

function secondMinusOne(numbers: number[]): number {
  return numbers[1] - 1;
}

function secondAsInteger(numbers: number[]): number {
  return numbers[1] | 0;
}

function secondNegated(numbers: number[]): number {
  return -numbers[1];
}

function secondIsFive(numbers: number[]): boolean[] {
  return [numbers[1] === 5, numbers[1] == 5, numbers[1] < 6, numbers[1] >= 5];
}

function secondIsTruthy(numbers: number[]): boolean {
  return numbers[1] ? true : false;
}

function secondKind(numbers: number[]): string {
  return typeof numbers[1];
}

function incrementSecond(numbers: number[]): unknown[] {
  const old = numbers[1]++;
  return [old, numbers[1]];
}

function sorted(numbers: number[]): number[] {
  return [...numbers].sort((a, b) => a - b);
}

const reads: [string, (numbers: number[]) => unknown][] = [
  ["typeof", secondKind],
  ["the element", second],
  ["sum", sum],
  ["product", product],
  ["- 1", secondMinusOne],
  ["| 0", secondAsInteger],
  ["negated", secondNegated],
  ["compared with 5", secondIsFive],
  ["truthy", secondIsTruthy],
  ["++", incrementSecond],
  ["sorted", sorted],
  ["Math.min", numbers => Math.min(...numbers)],
  ["JSON", numbers => JSON.stringify(numbers.map(number => (typeof number === "bigint" || typeof number === "symbol" ? "unprintable" : number)))],
  ["into a Float64Array", numbers => Array.from(new Float64Array(numbers))],
  ["into an Int32Array", numbers => Array.from(Int32Array.from(numbers))],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const honest of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += sum(honest) + product(honest) + second(honest) + secondMinusOne(honest) + secondAsInteger(honest) + secondNegated(honest);
    warm += secondIsFive(honest).length + (secondIsTruthy(honest) ? 1 : 0) + secondKind(honest).length + incrementSecond(honest).length + sorted(honest)[0];
  }
}
console.log("after 4000 honest arrays", warm);

for (const [name, visit] of visitors) {
  for (const [start, make] of [["integers", () => [1, 2, 3]]] satisfies [string, () => number[]][]) {
    for (const [read, run] of reads) {
      attempt(name + " among " + start + ": " + read, () => {
        const numbers = make();
        visit(numbers);
        return run(numbers);
      });
    }
  }
}
console.log("conversions", log.filter(entry => entry === "valueOf").length, log.filter(entry => entry === "toString").length);

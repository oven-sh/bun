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

type Wide = (number | string)[];

const ways: [string, (wide: Wide) => void][] = [
  ["push", wide => void wide.push("x")],
  ["an index store", wide => void (wide[1] = "x")],
  ["an index store past the end", wide => void (wide[wide.length] = "x")],
  ["splice", wide => void wide.splice(1, 1, "x")],
  ["fill", wide => void wide.fill("x", 1, 2)],
  ["unshift", wide => void wide.unshift("x")],
  ["a destructuring assignment", wide => void ([wide[0], wide[1]] = [wide[1], "x"])],
  ["a helper", wide => helper(wide)],
  ["push.apply", wide => void Array.prototype.push.apply(wide, ["x"])],
  ["Object.assign", wide => void Object.assign(wide, ["x"])],
  ["Reflect.set", wide => void Reflect.set(wide, 2, "x")],
  ["copyWithin after push", wide => void (wide.push("x"), wide.copyWithin(0, wide.length - 1))],
  ["a sort callback", wide => void wide.sort((a, b) => ((wide[0] = "x"), 0))],
  ["a forEach callback", wide => wide.forEach((_, index) => void (index === 1 && (wide[2] = "x")))],
];

function helper(list: Wide): void {
  list[list.length - 1] = "x";
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

function sumByReduce(numbers: number[]): number {
  return numbers.reduce((total, number) => total + number, 0);
}

function product(numbers: number[]): number {
  let total = 1;
  for (let i = 0; i < numbers.length; i++) total *= numbers[i];
  return total;
}

function asIntegers(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] | 0);
  return result;
}

function largest(numbers: number[]): number {
  return Math.max(...numbers);
}

function fixed(numbers: number[]): string {
  let text = "";
  for (const number of numbers) text += number.toFixed(1) + " ";
  return text;
}

function kinds(numbers: number[]): string {
  return numbers.map(number => typeof number).join();
}

const reads: [string, (numbers: number[]) => unknown][] = [
  ["sum", sum],
  ["sum by for-of", sumByForOf],
  ["sum by reduce", sumByReduce],
  ["product", product],
  ["as integers", asIntegers],
  ["largest", largest],
  ["toFixed", fixed],
  ["kinds", kinds],
  ["the array", numbers => numbers],
];

const starts: [string, () => number[]][] = [
  ["integers", () => [1, 2, 3]],
  ["doubles", () => [1.5, 2.5, 3.5]],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = i % 2 === 0 ? [i, 2, 3] : [i + 0.5, 2.5, 3.5];
  warm += sum(honest) + sumByForOf(honest) + sumByReduce(honest) + product(honest) + asIntegers(honest)[0] + largest(honest) + fixed(honest).length + kinds(honest).length;
}
console.log("after 2000 honest arrays", warm);

for (const [start, make] of starts) {
  for (const [way, pollute] of ways) {
    for (const [read, run] of reads) {
      attempt(start + ", " + way + ": " + read, () => {
        const numbers = make();
        const wide: Wide = numbers;
        pollute(wide);
        return run(numbers);
      });
    }
  }
}
attempt("honest again", () => [sum([1, 2, 3]), product([1.5, 2]), fixed([1]), largest([1, 2])]);

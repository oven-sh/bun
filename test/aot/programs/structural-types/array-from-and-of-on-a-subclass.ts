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

class List extends Array<number> {
  tag = "list";
  constructor(...items: number[]) {
    super(...items);
    log.push("new List(" + items.join() + ")");
  }
  total(): number {
    let sum = 0;
    for (const value of this) sum += value;
    return sum;
  }
}

function describe(numbers: number[]): unknown[] {
  return [numbers.constructor.name, numbers.length, [...numbers], Object.keys(numbers)];
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(Array.from([i, 1])) + sum(Array.of(i, 1)) + describe([i]).length;
console.log("after 2000 plain arrays", warm);

const makers: [string, () => number[]][] = [
  ["List.from(array)", () => List.from([1, 2, 3])],
  ["List.from(array-like)", () => List.from({ 0: 1, 1: 2, length: 2 })],
  ["List.from(array-like with a missing index)", () => List.from<number>({ 0: 1, length: 2 })],
  ["List.from(set)", () => List.from(new Set([1, 2]))],
  ["List.from(array, map)", () => List.from([1, 2], value => value * 2)],
  ["List.from({ length: 2 }, index)", () => List.from({ length: 2 }, (_, index) => index)],
  ["List.of(1, 2, 3)", () => List.of(1, 2, 3)],
  ["List.of(3)", () => List.of(3)],
  ["List.of()", () => List.of<number>()],
  ["Array.from(list)", () => Array.from(new List(1, 2, 3))],
  ["Array.from applied to List", () => Reflect.apply(Array.from, List, [[1, 2]])],
  ["Array.of applied to List", () => Reflect.apply(Array.of, List, [1, 2])],
];
for (const [name, make] of makers) {
  log.length = 0;
  attempt(name, () => describe(make()));
  console.log("  log: " + log.join("; "));
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": is a list with its method", () => {
    const made = make();
    return made instanceof List ? [made.tag, made.total()] : "no list";
  });
}
attempt("Array.from applied to a plain class", () => {
  class Bucket {
    length = 0;
    constructor(public asked?: number) {}
  }
  const made: unknown = Reflect.apply(Array.from, Bucket, [[7, 8]]);
  return [Array.isArray(made), made];
});
attempt("Array.from applied to something that is no constructor", () => describe(Reflect.apply(Array.from, Math.max, [[7, 8]])));

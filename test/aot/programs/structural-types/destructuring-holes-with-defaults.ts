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

function twoWithDefaults([a = 5, b = 6]: number[]): number[] {
  return [a, b];
}

function twoWithout([a, b]: number[]): unknown[] {
  return [a, b, typeof a, a + b];
}

function withRest([first, ...rest]: number[]): unknown[] {
  return [first, rest, 0 in rest, rest.length];
}

function skipping([, , third = -1]: number[]): number {
  return third;
}

function nested([[inner = 7] = []]: number[][]): number {
  return inner;
}

function byKeys({ 0: first, 1: second = 9, length }: number[]): unknown[] {
  return [first, second, length];
}

function assigned(numbers: number[]): number[] {
  let a = 1;
  let b = 2;
  [a = 10, b = 20] = numbers;
  return [a, b];
}

function swapped(numbers: number[]): unknown[] {
  [numbers[0], numbers[1]] = [numbers[1], numbers[0]];
  return [numbers, 0 in numbers, 1 in numbers];
}

const log: string[] = [];
function counted(name: string, value: number): number {
  log.push(name);
  return value;
}
function lazyDefaults([a = counted("a", 1), b = counted("b", 2)]: number[]): number[] {
  return [a, b];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const dense = [i, 2, 3];
  warm += twoWithDefaults(dense)[0] + twoWithout(dense).length + withRest(dense).length + skipping(dense) + nested([[i]]) + byKeys(dense).length + assigned(dense)[1] + swapped(dense).length + lazyDefaults(dense)[0];
}
console.log("after 2000 dense arrays", warm, log.length);

function firstOnly(): number[] {
  const numbers = new Array<number>(2);
  numbers[0] = 1;
  return numbers;
}
function secondOnly(): number[] {
  const numbers = new Array<number>(2);
  numbers[1] = 2;
  return numbers;
}

const makers: [string, () => number[]][] = [
  ["dense", () => [1, 2, 3]],
  ["holes", () => new Array<number>(3)],
  ["undefined from Array.from", () => Array.from<number>({ length: 3 })],
  ["empty", () => []],
  ["only the first", firstOnly],
  ["only the second", secondOnly],
  ["zeros", () => [0, -0, 0]],
  ["NaN", () => [NaN, NaN, NaN]],
];
for (const [name, make] of makers) {
  log.length = 0;
  attempt(name + ": two with defaults", () => twoWithDefaults(make()));
  attempt(name + ": two without", () => twoWithout(make()));
  attempt(name + ": with rest", () => withRest(make()));
  attempt(name + ": the third or -1", () => skipping(make()));
  attempt(name + ": by keys", () => byKeys(make()));
  attempt(name + ": assigned", () => assigned(make()));
  attempt(name + ": swapped", () => swapped(make()));
  attempt(name + ": defaults that are counted", () => [lazyDefaults(make()), log.join()]);
}
attempt("nested: holes outside", () => nested(new Array<number[]>(1)));
attempt("nested: holes inside", () => nested([new Array<number>(1)]));
attempt("nested: dense", () => nested([[3]]));

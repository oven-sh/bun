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

class Stack extends Array<number> {
  label = "stack";
  constructor(...items: number[]) {
    super(...items);
    log.push("constructed with " + items.join());
  }
  top(): number | undefined {
    return this[this.length - 1];
  }
  push(...items: number[]): number {
    log.push("push " + items.join());
    return super.push(...items);
  }
}

function stackOf(a: number, b: number, c: number): Stack {
  return new Stack(a, b, c);
}

function describe(numbers: number[]): unknown[] {
  return [numbers.constructor.name, numbers instanceof Stack, Array.isArray(numbers), [...numbers], Object.keys(numbers)];
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function pushOne(numbers: number[]): number {
  return numbers.push(9);
}

const makers: [string, (stack: Stack) => number[]][] = [
  ["slice", stack => stack.slice(1)],
  ["slice of everything", stack => stack.slice()],
  ["map", stack => stack.map(value => value * 2)],
  ["filter", stack => stack.filter(value => value > 1)],
  ["filter of nothing", stack => stack.filter(() => false)],
  ["concat", stack => stack.concat([4, 5])],
  ["concat onto a plain array", stack => [0].concat(stack)],
  ["splice", stack => stack.splice(0, 2)],
  ["flat", stack => stack.flat()],
  ["flatMap", stack => stack.flatMap(value => [value, value])],
  ["toSorted", stack => stack.toSorted()],
  ["toReversed", stack => stack.toReversed()],
  ["toSpliced", stack => stack.toSpliced(0, 1)],
  ["with", stack => stack.with(0, 7)],
  ["spread", stack => [...stack]],
  ["Array.from", stack => Array.from(stack)],
  ["reverse", stack => stack.reverse()],
  ["sort", stack => stack.sort()],
  ["fill", stack => stack.fill(0)],
  ["structuredClone", stack => structuredClone(stack)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum([i, 2, 3]) + pushOne([i]) + describe([i]).length;
console.log("after 2000 plain arrays", warm);

for (const [name, make] of makers) {
  log.length = 0;
  attempt(name + ": what it is", () => describe(make(stackOf(1, 2, 3))));
  console.log("  log: " + log.join("; "));
  attempt(name + ": sum", () => sum(make(stackOf(1, 2, 3))));
  log.length = 0;
  attempt(name + ": push", () => pushOne(make(stackOf(1, 2, 3))));
  console.log("  log: " + log.filter(entry => entry.startsWith("push")).join("; "));
}
attempt("a map to strings is still a stack", () => {
  const texts: string[] = stackOf(1, 2, 3).map(value => "s" + value);
  return [texts.constructor.name, texts instanceof Stack, texts.join()];
});
attempt("one element: the constructor takes it for a length", () => {
  const one = new Stack(3);
  return [one.length, 0 in one, one.map(value => value).length];
});

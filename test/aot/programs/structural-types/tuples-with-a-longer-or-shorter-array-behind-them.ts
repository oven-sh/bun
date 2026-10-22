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

type Pair = [number, number];

function lengthOf(pair: Pair): number {
  return pair.length;
}

function isTwoLong(pair: Pair): boolean {
  return pair.length === 2;
}

function sumOf(pair: Pair): number {
  return pair[0] + pair[1];
}

function sumByLoop(pair: Pair): number {
  let total = 0;
  for (let i = 0; i < pair.length; i++) total += pair[i];
  return total;
}

function sumByForOf(pair: Pair): number {
  let total = 0;
  for (const value of pair) total += value;
  return total;
}

function byPattern([a, b]: Pair): string {
  return typeof a + " " + typeof b;
}

function add(a: number, b: number): number {
  return a + b;
}

function countArguments(...values: number[]): number {
  return values.length;
}

function inspect(pair: Pair): unknown[] {
  return [pair.length, 0 in pair, 1 in pair, 2 in pair, pair[0], pair[1]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Pair = [i, 0.5];
  warm += lengthOf(honest) + (isTwoLong(honest) ? 1 : 0) + sumOf(honest) + sumByLoop(honest) + sumByForOf(honest) + byPattern(honest).length + add(...honest) + countArguments(...honest);
}
console.log("after 2000 honest pairs", warm);

const changes: [string, (pair: Pair) => void][] = [
  ["nothing", () => {}],
  ["push", pair => void pair.push(3)],
  ["push twice", pair => void pair.push(3, 4)],
  ["pop", pair => void pair.pop()],
  ["pop twice", pair => void (pair.pop(), pair.pop())],
  ["shift", pair => void pair.shift()],
  ["unshift", pair => void pair.unshift(0)],
  ["splice everything", pair => void pair.splice(0)],
  ["splice in the middle", pair => void pair.splice(1, 0, 1.5)],
  ["delete the second", pair => void Reflect.deleteProperty(pair, 1)],
  ["the length through an array type", pair => {
    const list: number[] = pair;
    list.length = 5;
  }],
  ["the length to zero through an array type", pair => {
    const list: number[] = pair;
    list.length = 0;
  }],
];
for (const [name, change] of changes) {
  const make = (): Pair => {
    const pair: Pair = [1, 2];
    change(pair);
    return pair;
  };
  attempt(name + ": inspected", () => inspect(make()));
  attempt(name + ": length", () => lengthOf(make()));
  attempt(name + ": is two long", () => isTwoLong(make()));
  attempt(name + ": sum", () => sumOf(make()));
  attempt(name + ": sum by a loop", () => sumByLoop(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": by a pattern", () => byPattern(make()));
  attempt(name + ": spread into two parameters", () => add(...make()));
  attempt(name + ": spread into a rest parameter", () => countArguments(...make()));
  attempt(name + ": the whole", () => make());
}
attempt("an open tuple", () => {
  const row: [number, ...number[]] = [1];
  row.pop();
  return [row.length, row[0], typeof row[0], row[0] + 1];
});
attempt("an optional place that is absent", () => {
  const some: [number, number?] = [1];
  return [some.length, some[1], 1 in some, (some[1] ?? 5) + 1];
});
attempt("an optional place that holds undefined", () => {
  const some: [number, number?] = [1, undefined];
  return [some.length, some[1], 1 in some];
});
attempt("a tuple returned by a function that reuses one array", () => {
  const shared: Pair = [0, 0];
  const next = (value: number): Pair => {
    shared[0] = value;
    shared[1] = value * 2;
    return shared;
  };
  const first = next(1);
  const second = next(2);
  return [first, second, first === second];
});

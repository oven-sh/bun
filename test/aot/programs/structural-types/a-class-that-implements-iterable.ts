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

class Countdown implements Iterable<number> {
  constructor(private from: number) {}
  [Symbol.iterator](): Iterator<number> {
    let current = this.from;
    log.push("iterator");
    return {
      next: () => {
        log.push("next");
        return current > 0 ? { done: false, value: current-- } : { done: true, value: undefined };
      },
      return: () => {
        log.push("return");
        return { done: true, value: undefined };
      },
    };
  }
}

class Liar implements Iterable<number> {
  *[Symbol.iterator](): Generator<number> {
    const numbers: number[] = new Array<number>(2);
    yield numbers[0];
    yield 1;
    yield numbers[1];
  }
}

function total(numbers: Iterable<number>): number {
  let sum = 0;
  for (const number of numbers) sum += number;
  return sum;
}

function firstAbove(numbers: Iterable<number>, limit: number): number {
  for (const number of numbers) if (number > limit) return number;
  return -1;
}

function firstTwo(numbers: Iterable<number>): number[] {
  const [a, b] = numbers;
  return [a, b];
}

function firstAndRest(numbers: Iterable<number>): [number, number[]] {
  const [first, ...rest] = numbers;
  return [first, rest];
}

function spread(numbers: Iterable<number>): number[] {
  return [...numbers];
}

function largest(numbers: Iterable<number>): number {
  return Math.max(...numbers);
}

function* plusOne(numbers: Iterable<number>): Generator<number> {
  for (const number of numbers) yield number + 1;
}

function* delegated(numbers: Iterable<number>): Generator<number> {
  yield* numbers;
}

function throwsInside(numbers: Iterable<number>): number {
  for (const number of numbers) if (number < 3) throw new RangeError("low");
  return 0;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [i, 2, 3];
  warm += total(honest) + firstAbove(honest, 2) + firstTwo(honest)[1] + firstAndRest(honest)[1].length + spread(honest).length + largest(honest) + total(plusOne(honest)) + total(delegated(honest));
}
console.log("after 2000 arrays", warm);

const makers: [string, () => Iterable<number>][] = [
  ["an array", () => [3, 2, 1]],
  ["a countdown", () => new Countdown(3)],
  ["a set", () => new Set([3, 2, 1, 3])],
  ["keys of a map", () => new Map([[3, "c"], [2, "b"]]).keys()],
  ["bytes", () => new Uint8Array([3, 2, 1])],
  ["a generator", () => plusOne([2, 1, 0])],
  ["an array with holes", () => new Array<number>(2)],
  ["a liar", () => new Liar()],
  ["an empty countdown", () => new Countdown(0)],
];
for (const [name, make] of makers) {
  log.length = 0;
  attempt(name + ": total", () => total(make()));
  attempt(name + ": first above 1", () => firstAbove(make(), 1));
  attempt(name + ": first two", () => firstTwo(make()));
  attempt(name + ": first and rest", () => firstAndRest(make()));
  attempt(name + ": spread", () => spread(make()));
  attempt(name + ": largest", () => largest(make()));
  attempt(name + ": plus one", () => spread(plusOne(make())));
  attempt(name + ": delegated", () => spread(delegated(make())));
  attempt(name + ": throws inside the loop", () => throwsInside(make()));
  attempt(name + ": Array.from", () => Array.from(make(), number => number * 2));
  attempt(name + ": new Set", () => new Set(make()).size);
  console.log(name + ": log", log.join(" "));
}

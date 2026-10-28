import { runInNewContext } from "node:vm";

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function" || typeof value === "symbol") return typeof value;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  for (const key of Object.keys(value)) parts.push(key + ": " + show(Reflect.get(value, key)));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

const things = {
  honest: "3",
  fraction: "1.5",
  negativeZero: "-0",
  notANumber: "NaN",
  infinite: "Infinity",
  large: "2 ** 31",
  larger: "2 ** 53",
  negative: "-1",
  digits: "'3'",
  letters: "'abc'",
  noText: "''",
  yes: "true",
  nothing: "null",
  missing: "undefined",
  big: "3n",
  boxed: "new Number(3)",
  valued: "{ valueOf() { log.push('valueOf'); return 3; } }",
  primitive: "{ [Symbol.toPrimitive](hint) { log.push(hint); return 3; } }",
  date: "new Date(3)",
  one: "[3]",
  none: "[]",
  plain: "{}",
};
const names = Object.keys(things);

function get(name: string) {
  return runInNewContext("(" + Reflect.get(things, name) + ")", { log });
}

const table = [10, 20, 30, 40];

function plusOne(n: number): number {
  return n + 1;
}

function pick(n: number): number {
  return table[n];
}

class Counter {
  n: number;
  constructor(name: string) {
    this.n = get(name);
  }
  next(): number {
    return this.n + 1;
  }
  bump(): number {
    this.n++;
    return this.n;
  }
}

console.log("honest callers: " + [plusOne(1), plusOne(2.5), pick(0), pick(3)].join(" "));

const sinks: [string, (name: string) => unknown][] = [
  [
    "itself",
    name => {
      const n: number = get(name);
      return [n, typeof n];
    },
  ],
  [
    "arithmetic",
    name => {
      const n: number = get(name);
      return [n + 1, n - 1, n * 2, n / 2, n % 2, -n];
    },
  ],
  [
    "bits",
    name => {
      const n: number = get(name);
      return [n | 0, n >>> 0, n << 1, ~n];
    },
  ],
  [
    "comparisons",
    name => {
      const n: number = get(name);
      return [n < 4, n >= 3, n === 3, n == 3, n !== n];
    },
  ],
  [
    "an index",
    name => {
      const n: number = get(name);
      return [table[n], "abcd"[n], table.at(n), "abcd".charAt(n)];
    },
  ],
  ["a parameter", name => [plusOne(get(name)), pick(get(name))]],
  [
    "a field",
    name => {
      const counter = new Counter(name);
      return [counter.next(), counter.bump(), counter.n];
    },
  ],
  [
    "an element",
    name => {
      const list: number[] = [1, get(name)];
      list.push(get(name));
      let total = 0;
      for (const n of list) total += n;
      return [total, list];
    },
  ],
  [
    "a map value",
    name => {
      const map = new Map<string, number>([["first", 1]]);
      map.set("second", get(name));
      let total = 0;
      for (const n of map.values()) total += n;
      return total;
    },
  ],
  [
    "an update",
    name => {
      let n: number = get(name);
      n++;
      const after = n;
      n += 1;
      return [after, n, typeof n];
    },
  ],
  [
    "a bound of a loop",
    name => {
      const n: number = get(name);
      let count = 0;
      for (let i = 0; i < n && i < 5; i++) count++;
      return count;
    },
  ],
  [
    "a text",
    name => {
      const n: number = get(name);
      return [String(n), `<${n}>`, n + ""];
    },
  ],
  [
    "a method",
    name => {
      const n: number = get(name);
      return n.toFixed(1);
    },
  ],
];

for (const [sink, run] of sinks) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run("honest");
    rounds++;
  }
  console.log(sink + ": " + rounds + " honest rounds");
  for (const name of names) attempt(sink + ", " + name, () => run(name));
  attempt(sink + ", honest again", () => run("honest"));
}

interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
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

function plusOne(n: number): number {
  return n + 1;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function* numbersThenAText() {
  yield 1;
  yield "2";
  return 3;
}

const things = new Map<string, unknown>([
  ["numbers", [1, 2]],
  ["mixed", [1, "2", null, [3]]],
  ["holes", [1, , 3]],
  ["a text", "12"],
  ["a text of two units", "\u{1F600}"],
  ["a set", new Set([1, "2"])],
  ["a map", new Map([[1, "one"]])],
  ["a typed array", new Uint8Array([1, 2])],
  ["a generator", { [Symbol.iterator]: numbersThenAText }],
  [
    "an iterator that logs",
    {
      [Symbol.iterator]() {
        log.push("iterator");
        let i = 0;
        return {
          next() {
            log.push("next");
            return { done: i >= 2, value: i++ };
          },
          return() {
            log.push("return");
            return {};
          },
        };
      },
    },
  ],
  ["results without done", { [Symbol.iterator]: () => ({ n: 0, next() { return this.n++ < 2 ? { value: "v" } : { done: 1 }; } }) }],
  ["next answers a number", { [Symbol.iterator]: () => ({ next: () => 5 }) }],
  ["an array-like", { 0: 1, 1: 2, length: 2 }],
  ["a number", 12],
  ["null", null],
]);
const lookUp: Function = (name: string) => things.get(name);

const uses: [string, (name: string) => unknown][] = [
  [
    "for of into a number",
    name => {
      let total = 0;
      for (const item of lookUp(name)) {
        const n: number = item;
        total += n;
      }
      return [total, typeof total];
    },
  ],
  [
    "for of into a parameter",
    name => {
      const seen: number[] = [];
      for (const item of lookUp(name)) seen.push(plusOne(item));
      return seen;
    },
  ],
  [
    "for of into a point",
    name => {
      const seen: number[] = [];
      for (const item of lookUp(name)) {
        const p: Point = item;
        seen.push(sum(p));
      }
      return seen;
    },
  ],
  [
    "for of that stops early",
    name => {
      for (const item of lookUp(name)) {
        const n: number = item;
        return n + 1;
      }
      return "empty";
    },
  ],
  [
    "spread into a list of numbers",
    name => {
      const list: number[] = [...lookUp(name)];
      return [list, list.map(plusOne)];
    },
  ],
  [
    "a pattern",
    name => {
      const [a, b = 7, ...rest]: number[] = lookUp(name);
      return [a + 1, b + 1, rest];
    },
  ],
  ["spread into operands", name => Math.max(...lookUp(name))],
  [
    "a set and a map of it",
    name => {
      const set: Set<number> = new Set(lookUp(name));
      let total = 0;
      for (const n of set) total += n;
      return [set.size, total];
    },
  ],
  [
    "yield star",
    name => {
      function* all(): Generator<number> {
        yield* lookUp(name);
      }
      let total = 0;
      for (const n of all()) total += n;
      return total;
    },
  ],
  [
    "for in",
    name => {
      const keys: string[] = [];
      for (const key in lookUp(name)) keys.push(key);
      return keys;
    },
  ],
];

for (const [use, run] of uses) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run("numbers");
    rounds++;
  }
  console.log(use + ": " + rounds + " honest rounds");
  for (const name of things.keys()) attempt(use + ", " + name, () => run(name));
}

export {};

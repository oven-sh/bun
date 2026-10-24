interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

function shifted(this: Point, n: number): number {
  return this.x + this.y + n;
}

function isRight(this: Point, n: number): boolean {
  return n > this.x;
}

function kind(this: Point): string {
  return typeof this;
}

class Scale {
  factor = 3;
  apply(n: number): number {
    return n * this.factor;
  }
}

const honest: Point = { x: 1, y: 2 };

const receivers: [string, unknown][] = [
  ["honest", honest],
  ["swapped", { y: 2, x: 1 }],
  ["texts", { x: "1", y: "2" }],
  ["partial", { x: 1 }],
  [
    "getters",
    {
      get x() {
        log.push("x");
        return 1;
      },
      get y() {
        log.push("y");
        return 2;
      },
    },
  ],
  ["a list", [1, 2]],
  ["bigints", { x: 1n, y: 2n }],
  ["a scale", new Scale()],
  ["a text", "xy"],
  ["a number", 5],
  ["true", true],
  ["null", null],
  ["undefined", undefined],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += [1, 2].map(shifted, honest)[1] + [1, 2].filter(isRight, honest).length + [1].map(new Scale().apply, new Scale())[0];
console.log("2000 honest rounds: " + warm);

for (const [name, receiver] of receivers) {
  attempt("map, " + name, () => [1, 2].map(shifted, receiver));
  attempt("filter, " + name, () => [1, 2].filter(isRight, receiver));
  attempt("some and every, " + name, () => [[1, 2].some(isRight, receiver), [1, 2].every(isRight, receiver)]);
  attempt("find, " + name, () => [[1, 2].find(isRight, receiver), [1, 2].findIndex(isRight, receiver), [1, 2].findLast(isRight, receiver)]);
  attempt("Array.from, " + name, () => Array.from([1, 2], shifted, receiver));
  attempt("typed array, " + name, () => Array.from(new Float64Array([1, 2]).map(shifted, receiver)));
  attempt("forEach of a set, " + name, () => {
    const seen: number[] = [];
    new Set([1]).forEach(function (this: Point, n) {
      seen.push(this.x + n);
    }, receiver);
    return seen;
  });
  attempt("typeof this, " + name, () => [0].map(kind, receiver));
  attempt("a method of a class, " + name, () => [1, 2].map(new Scale().apply, receiver));
}

attempt("no operand for this", () => [1, 2].map(shifted));
attempt("a method of a class and no operand for this", () => [1, 2].map(new Scale().apply));
attempt("honest again", () => [1, 2].map(shifted, honest));

export {};

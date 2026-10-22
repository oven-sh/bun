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

type Fixable = { toFixed(digits: number): string };

class Cell {
  before = 1;
  value: {};
  after = 2;
  constructor(value: {}) {
    this.value = value;
  }
  kind(): string {
    return typeof this.value;
  }
}

class Amount {
  label = "amount";
  value: Fixable;
  scale = 0.5;
  constructor(value: Fixable) {
    this.value = value;
  }
  text(): string {
    return this.value.toFixed(2);
  }
}

class Pair {
  constructor(public left: Object, public right: { valueOf(): number }) {}
  sum(): number {
    return this.right.valueOf() + this.right.valueOf();
  }
}

function readCell(cell: Cell): {} {
  return cell.value;
}

function around(cell: Cell): number {
  return cell.before + cell.after;
}

const numbers: [string, number][] = [
  ["0", 0],
  ["-0", -0],
  ["1", 1],
  ["-1", -1],
  ["0.5", 0.5],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["2 ** 31 - 1", 2 ** 31 - 1],
  ["2 ** 31", 2 ** 31],
  ["-(2 ** 31) - 1", -(2 ** 31) - 1],
  ["2 ** 32 + 5", 2 ** 32 + 5],
  ["2 ** 53", 2 ** 53],
  ["the smallest double", Number.MIN_VALUE],
  ["the largest double", Number.MAX_VALUE],
  ["1e-7", 1e-7],
];

let warm = 0;
const reused = new Cell({});
const reusedAmount = new Amount({ toFixed: () => "" });
for (let i = 0; i < 2000; i++) {
  const cell = new Cell({ i });
  warm += cell.kind().length + around(cell) + Object.keys(readCell(cell)).length;
  reused.value = { i };
  warm += new Amount({ toFixed: digits => String(digits) }).text().length + new Pair({}, { valueOf: () => i }).sum();
}
console.log("after 2000 objects", warm);

for (const [name, number] of numbers) {
  attempt(name + ": a new cell", () => {
    const cell = new Cell(number);
    return [cell.kind(), readCell(cell), cell.value, around(cell), Object.is(cell.value, number)];
  });
  attempt(name + ": stored into an old cell", () => {
    reused.value = number;
    return [reused.kind(), readCell(reused), around(reused), Object.is(reused.value, number)];
  });
  attempt(name + ": an amount", () => {
    const amount = new Amount(number);
    reusedAmount.value = number;
    return [amount.label, amount.text(), amount.scale, reusedAmount.text(), typeof reusedAmount.value];
  });
  attempt(name + ": a pair", () => {
    const pair = new Pair(number, number);
    return [pair.left, pair.right, pair.sum()];
  });
  attempt(name + ": a member of a literal", () => {
    const literal: { a: number; held: {}; b: number } = { a: 1, held: number, b: 2 };
    return [literal.a, literal.held, literal.b, JSON.stringify(literal)];
  });
}

const others: [string, {}][] = [
  ["a string", "text"],
  ["true", true],
  ["false", false],
  ["a symbol", Symbol("s")],
  ["a bigint", 2n ** 64n],
  ["an object again", { back: true }],
];
for (const [name, value] of others) {
  attempt(name + ": stored into an old cell", () => {
    reused.value = value;
    return [reused.kind(), readCell(reused), around(reused), reused.value === value];
  });
}
attempt("many cells, each with another kind", () => {
  const cells: Cell[] = [];
  for (let i = 0; i < 12; i++) cells.push(new Cell(i % 4 === 0 ? i : i % 4 === 1 ? i / 8 : i % 4 === 2 ? "s" + i : { i }));
  return cells.map(cell => cell.value);
});

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

class Cell<out T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  put(value: T): void {
    this.value = value;
  }
  swap(other: Cell<T>): void {
    const kept = this.value;
    this.value = other.value;
    other.value = kept;
  }
}

interface Sink<out T> {
  items: T[];
  accept(item: T): number;
}

class Exact<in out T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  put(value: T): void {
    this.value = value;
  }
}

function plusOne(cell: Cell<number>): number {
  return cell.value + 1;
}

function shout(cell: Cell<string>): string {
  return cell.value.toUpperCase();
}

function sum(sink: Sink<number>): number {
  let total = 0;
  for (let i = 0; i < sink.items.length; i++) total += sink.items[i];
  return total;
}

function fillWide(cell: Cell<number | string>, value: number | string): void {
  cell.put(value);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const cell = new Cell(i);
  fillWide(cell, i + 1);
  total += plusOne(cell) + shout(new Cell("s")).length + new Exact(i).value;
}
console.log("2000 honest rounds: " + total);

const numbers = new Cell<number>(1);
const wide: Cell<number | string> = numbers;
wide.put("text");
console.log("a string by put: " + typeof numbers.value + " " + show(numbers.value) + " " + JSON.stringify(numbers));
attempt("  plusOne", () => plusOne(numbers));
attempt("  value * 2", () => numbers.value * 2);
attempt("  value.toFixed(1)", () => numbers.value.toFixed(1));

wide.value = "stored";
console.log("a string by a store: " + typeof numbers.value + " " + show(numbers.value));
attempt("  plusOne", () => plusOne(numbers));

const fractions = new Cell<number>(0.5);
fillWide(fractions, "through a function");
console.log("a string through a function: " + typeof fractions.value + " " + show(fractions.value));
attempt("  plusOne", () => plusOne(fractions));

const strings = new Cell<string>("s");
const alsoWide: Cell<number | string> = strings;
const fresh = new Cell<number>(7);
alsoWide.swap(fresh);
console.log("a cell of strings and a cell of numbers swap: " + typeof strings.value + " " + show(strings.value) + ", " + typeof fresh.value + " " + show(fresh.value));
attempt("  shout", () => shout(strings));
attempt("  plusOne", () => plusOne(fresh));

const sink: Sink<number> = {
  items: [1, 2],
  accept(item) {
    return this.items.push(item);
  },
};
const wideSink: Sink<number | string | null> = sink;
wideSink.accept("three");
console.log("a sink of numbers: " + show(sink.items));
attempt("  sum", () => sum(sink));
wideSink.accept(null);
attempt("  sum with null", () => sum(sink));
attempt("  the last one + 1", () => sink.items[3] + 1);
attempt("  the last one's toFixed", () => sink.items[3].toFixed(0));

const nothing: Cell<number | undefined> = new Cell<number>(1);
nothing.put(undefined);
attempt("undefined in a cell of numbers", () => [typeof nothing.value, JSON.stringify(nothing), Object.keys(nothing)]);

export {};

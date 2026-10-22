function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Stack<T> {
  private items: T[] = [];
  push(item: T): number {
    return this.items.push(item);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  peek(): T {
    return this.items[this.items.length - 1];
  }
  at(index: number): T {
    return this.items[index];
  }
  get size(): number {
    return this.items.length;
  }
  *[Symbol.iterator](): Generator<T> {
    for (let i = 0; i < this.items.length; i++) yield this.items[i];
  }
  fold<U>(start: U, f: (sum: U, item: T) => U): U {
    let sum = start;
    for (const item of this.items) sum = f(sum, item);
    return sum;
  }
}

function filled<T>(...items: T[]): Stack<T> {
  const s = new Stack<T>();
  for (const item of items) s.push(item);
  return s;
}

function sum(s: Stack<number>): number {
  return s.fold(0, (a, b) => a + b);
}

function topPlusOne(s: Stack<number>): number {
  return s.peek() + 1;
}

function letters(s: Stack<string>): number {
  let n = 0;
  for (const word of s) n += word.length;
  return n;
}

attempt("integers", () => [sum(filled(1, 2, 3)), topPlusOne(filled(1, 2, 3))]);
attempt("fractions", () => [sum(filled(0.5, 0.25)), topPlusOne(filled(0.5))]);
attempt("integers then a fraction", () => [sum(filled(1, 2, 0.5)), topPlusOne(filled(1, 0.5))]);
attempt("negative zero", () => [filled(-0).peek(), sum(filled(-0)), filled(-0, -0).fold(-0, (a, b) => a + b)]);
attempt("not a number", () => [sum(filled(1, NaN)), topPlusOne(filled(NaN))]);
attempt("large integers", () => [sum(filled(2147483647, 1)), topPlusOne(filled(2147483647)), sum(filled(-2147483648, -1))]);
attempt("strings", () => letters(filled("a", "bc")));
attempt("objects", () => filled({ n: 1 }, { n: 2 }).fold(0, (a, o) => a + o.n));
attempt("objects of two shapes", () => {
  const wider = { extra: "e", n: 2 };
  return filled<{ n: number }>({ n: 1 }, wider).fold(0, (a, o) => a + o.n);
});
attempt("stacks of stacks", () => filled(filled(1), filled(2, 3)).fold(0, (a, s) => a + sum(s)));
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(filled(i, 1)) + topPlusOne(filled(i)) + letters(filled("ab"));
console.log("2000 honest rounds", warm);

attempt("peek at an empty stack", () => topPlusOne(new Stack<number>()));
attempt("peek at an empty stack of strings", () => new Stack<string>().peek().length);
attempt("at past the end", () => filled(1, 2).at(5) + 1);
attempt("at a negative index", () => filled(1, 2).at(-1) + 1);
attempt("at a fraction", () => filled(1, 2).at(0.5) + 1);
attempt("pop until empty", () => {
  const s = filled(1, 2);
  return [s.pop(), s.pop(), s.pop(), s.size];
});
attempt("a stack of numbers seen as wider", () => {
  const numbers = filled(1, 2);
  const wide: Stack<number | string> = numbers;
  wide.push("3");
  return [sum(numbers), topPlusOne(numbers), numbers.size];
});
attempt("a stack of numbers gets undefined", () => {
  const numbers = filled(1, 2);
  const wide: Stack<number | undefined> = numbers;
  wide.push(undefined);
  return [sum(numbers), topPlusOne(numbers)];
});
attempt("a stack of strings gets a number", () => {
  const words = filled("a");
  const wide: Stack<string | number> = words;
  wide.push(5);
  return letters(words);
});
attempt("pushed while iterating", () => {
  const s = filled(1, 2);
  let n = 0;
  for (const item of s) {
    if (s.size < 5) s.push(item * 10);
    n += item;
  }
  return n;
});
attempt("spread and destructured", () => {
  const [first, second, third] = filled(1, 2);
  return [first, second, third, [...filled("a", "b")], Math.max(...filled(3, 9, 4))];
});

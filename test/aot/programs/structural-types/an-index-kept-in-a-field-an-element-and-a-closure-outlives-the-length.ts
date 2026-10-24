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

class Cursor {
  items: string[];
  position = 0;
  constructor(items: string[]) {
    this.items = items;
  }
  current(): string {
    return this.items[this.position];
  }
  width(): number {
    return this.items[this.position].length;
  }
  advance(): this {
    this.position++;
    return this;
  }
}

class Ring {
  slots: number[] = [1, 2, 3, 4];
  head = 3;
  read(): number {
    return this.slots[this.head] + 1;
  }
}

function reader(numbers: number[], index: number): () => number {
  return () => numbers[index] * 2;
}

function pick(numbers: number[], order: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < order.length; i++) out.push(numbers[order[i]]);
  return out;
}

function pickSum(numbers: number[], order: number[]): number {
  let sum = 0;
  for (const index of order) sum += numbers[index];
  return sum;
}

let total = 0;
const warmRing = new Ring();
for (let i = 0; i < 2000; i++) {
  const cursor = new Cursor(["a", "bc"]);
  total += cursor.width() + cursor.advance().width() + warmRing.read() + reader([i, 1], 0)() + pickSum([i, 1, 2], [2, 0]);
}
console.log("2000 honest rounds: " + total);

const cursor = new Cursor(["a", "b"]);
attempt("a field: at 0", () => [cursor.current(), cursor.width()]);
cursor.advance().advance();
attempt("a field: past the end", () => [cursor.position, typeof cursor.current()]);
attempt("a field: past the end, a method", () => cursor.width());
cursor.items.push("c");
attempt("a field: the list has caught up", () => [cursor.current(), cursor.width()]);
cursor.items.length = 1;
attempt("a field: the list is cut under it", () => typeof cursor.current());
cursor.position = -1;
attempt("a field: minus one", () => typeof cursor.current());
cursor.position = 0.5;
attempt("a field: a half", () => typeof cursor.current());
cursor.position = 0;
attempt("a field: back at 0", () => [cursor.current(), cursor.width()]);

const ring = new Ring();
attempt("a ring", () => ring.read());
ring.slots.pop();
attempt("a ring: its head's slot is popped", () => ring.read());
ring.slots.length = 0;
attempt("a ring: emptied", () => ring.read());

const numbers = [1, 2, 3];
const third = reader(numbers, 2);
attempt("a captured index", () => third());
numbers.pop();
attempt("a captured index: the list is popped", () => third());
numbers.push(0.5);
attempt("a captured index: a fraction is pushed", () => third());

attempt("indexes that are elements", () => [pick([10, 20, 30], [2, 0, 1]), pick([10, 20, 30], [3, -1, 0.5, NaN, 0]), pick([0.5], [0, 1])]);
attempt("indexes that are elements: sums", () => [pickSum([10, 20, 30], [2, 0]), pickSum([10, 20, 30], [2, 3]), pickSum([10, 20, 30], [])]);
attempt("indexes that are holes", () => [pick([10, 20], new Array<number>(2)), pickSum([10, 20], new Array<number>(2))]);
attempt("an index from another list's length", () => {
  const long = [1, 2, 3, 4];
  const short = ["a", "b"];
  const seen: string[] = [];
  for (let i = 0; i < long.length; i++) seen.push(typeof short[i]);
  return seen;
});
attempt("an index from another list's length: a method", () => {
  const long = [1, 2, 3];
  const short = ["a", "b"];
  let width = 0;
  for (let i = 0; i < long.length; i++) width += short[i].length;
  return width;
});

export {};

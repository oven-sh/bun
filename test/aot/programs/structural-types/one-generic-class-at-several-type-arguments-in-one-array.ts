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

class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
  set(value: T): void {
    this.value = value;
  }
  map<U>(f: (value: T) => U): Box<U> {
    return new Box(f(this.value));
  }
}

interface Point {
  x: number;
  y: number;
}

function half(b: Box<number>): number {
  return b.get() / 2;
}

function size(b: Box<string>): number {
  return b.value.length;
}

function sum(b: Box<Point>): number {
  return b.value.x + b.get().y;
}

function total(b: Box<number[]>): number {
  let result = 0;
  for (const n of b.get()) result += n;
  return result;
}

function run(b: Box<() => number>): number {
  return b.get()() + b.value();
}

function kind(b: Box<unknown>): string {
  return typeof b.get();
}

attempt("each alone", () => [half(new Box(3)), half(new Box(1.5)), size(new Box("ab")), sum(new Box({ x: 1, y: 2 })), total(new Box([1, 2])), run(new Box(() => 4))]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(new Box(i)) + size(new Box("ab")) + sum(new Box({ x: i, y: 1 })) + total(new Box([i])) + run(new Box(() => i));
console.log("2000 honest rounds", warm);

attempt("all in one array", () => {
  const boxes: Box<unknown>[] = [new Box(1), new Box(1.5), new Box("s"), new Box({ x: 1, y: 2 }), new Box([1]), new Box(() => 1), new Box(null), new Box(undefined), new Box(1n), new Box(true), new Box(-0), new Box(new Box(1))];
  return boxes.map(kind);
});
attempt("values read from one array", () => {
  const boxes: Box<number | string>[] = [new Box<number | string>(1), new Box<number | string>("s"), new Box<number | string>(2.5)];
  return boxes.map(b => {
    const v = b.get();
    return typeof v === "number" ? v + 1 : v + "!";
  });
});
attempt("a box of numbers seen as a box of numbers or strings", () => {
  const numbers = new Box(1);
  const wide: Box<number | string> = numbers;
  wide.set("text");
  return [half(numbers), numbers.value, typeof numbers.get()];
});
attempt("the same through the field", () => {
  const numbers = new Box(1);
  const wide: Box<number | string> = numbers;
  wide.value = "text";
  return numbers.value + 1;
});
attempt("a box of points seen as a box of narrower things", () => {
  const points = new Box<Point>({ x: 1, y: 2 });
  const wide: Box<{ x: number }> = points;
  wide.set({ x: 5 });
  return sum(points);
});
attempt("a box of lists gets a string through a wider view", () => {
  const lists = new Box<number[]>([1, 2]);
  const wide: Box<number[] | string> = lists;
  wide.set("12");
  return total(lists);
});
attempt("a box of functions gets a class through a wider view", () => {
  const functions = new Box<() => number>(() => 1);
  const wide: Box<Function> = functions;
  wide.set(class {});
  return run(functions);
});
attempt("a box emptied through a wider view", () => {
  const texts = new Box("ab");
  const wide: Box<string | null> = texts;
  wide.set(null);
  return size(texts);
});
attempt("mapped from kind to kind", () => new Box(1).map(n => "n" + n).map(s => s.length).map(n => [n, n]).map(l => l.length).get());
attempt("one site sees every kind in turn", () => {
  const read = <T>(b: Box<T>): T => b.get();
  const results: unknown[] = [];
  for (let i = 0; i < 2000; i++) {
    const n = read(new Box(i));
    const s = read(new Box("s" + i));
    const p = read(new Box({ x: i, y: 1 }));
    if (i === 1999) results.push(n + 1, s.length, p.x + p.y);
  }
  return results;
});
attempt("a literal stands for a box", () => {
  const fake: Box<number> = { value: 8, get: () => 80, set: () => {}, map: <U>(f: (value: number) => U) => new Box(f(800)) };
  return [half(fake), fake.map(n => n + 1).get(), fake instanceof Box];
});
attempt("subclasses at fixed arguments", () => {
  class Count extends Box<number> {
    get(): number {
      return super.get() + 100;
    }
  }
  class Name extends Box<string> {}
  const boxes: Box<number | string>[] = [new Count(1), new Name("n")];
  return [half(new Count(2)), size(new Name("abc")), boxes.map(b => b.get())];
});

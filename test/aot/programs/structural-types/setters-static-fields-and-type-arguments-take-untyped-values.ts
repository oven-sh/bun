interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Meter {
  #value = 0;
  doubled = 0;
  static limit = 10;
  static origin: Point = { x: 0, y: 0 };
  set value(n: number) {
    this.#value = n;
    this.doubled = n * 2;
  }
  get value(): number {
    return this.#value;
  }
  overLimit(): boolean {
    return this.#value > Meter.limit;
  }
}

class Box<T> {
  constructor(public content: T) {}
  get(): T {
    return this.content;
  }
  set(content: T): void {
    this.content = content;
  }
}

function same<T>(value: T): T {
  return value;
}

function firstOf<T>(list: T[]): T {
  return list[0];
}

function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}

function sum(p: Point): number {
  return p.x + p.y;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const meter = new Meter();
  meter.value = i;
  warm += meter.value + meter.doubled + new Box<number>(i).get() + same<number>(i) + firstOf<number>([i]) + sum(new Box<Point>({ x: i, y: 1 }).get());
}
console.log("2000 honest rounds: " + warm);

for (const text of ["1", '"11"', "true", "null", "[12]", "{}"]) {
  attempt("a setter gets " + text, () => {
    const meter = new Meter();
    meter.value = JSON.parse(text);
    return [meter.value, typeof meter.value, meter.value + 1, meter.doubled, meter.overLimit()];
  });
  attempt("a static field gets " + text, () => {
    Meter.limit = JSON.parse(text);
    const meter = new Meter();
    meter.value = 5;
    const result = [Meter.limit, typeof Meter.limit, Meter.limit + 1, meter.overLimit()];
    Meter.limit = 10;
    return result;
  });
  attempt("a box of numbers gets " + text, () => {
    const box = new Box<number>(JSON.parse(text));
    const first = box.get() + 1;
    box.set(2);
    const second = box.get() + 1;
    box.set(JSON.parse(text));
    return [first, second, box.content, box.get() + 1];
  });
  attempt("a box typed by its variable gets " + text, () => {
    const box: Box<number> = new Box(JSON.parse(text));
    return [box.get() + 1, typeof box.content];
  });
  attempt("a type argument is written out, " + text, () => [same<number>(JSON.parse(text)) + 1, firstOf<number>(JSON.parse("[" + text + "]")) + 1]);
  attempt("a type argument comes from the variable, " + text, () => {
    const n: number = same(JSON.parse(text));
    const m: number = firstOf(JSON.parse("[" + text + "]"));
    return [n + 1, m + 1];
  });
  attempt("a pair, " + text, () => {
    const [a, b]: [number, string] = pair(JSON.parse(text), JSON.parse(text));
    return [a + 1, b + "!", typeof a, typeof b];
  });
  attempt("satisfies, " + text, () => {
    const n = JSON.parse(text) satisfies number;
    const m: number = n;
    return m + 1;
  });
}

for (const text of ['{"x":1,"y":2}', '{"y":"2","x":"1"}', '{"x":1}', "[1,2]", '"xy"', "7"]) {
  attempt("a static point gets " + text, () => {
    Meter.origin = JSON.parse(text);
    const result = [sum(Meter.origin), Meter.origin.x, Object.keys(Meter.origin).join()];
    Meter.origin = { x: 0, y: 0 };
    return result;
  });
  attempt("a box of points gets " + text, () => {
    const box = new Box<Point>(JSON.parse(text));
    return [sum(box.get()), box.content.y];
  });
  attempt("boxes of points in a list, " + text, () => {
    const boxes: Box<Point>[] = [new Box({ x: 1, y: 2 }), new Box(JSON.parse(text))];
    let total = 0;
    for (const box of boxes) total += box.get().x;
    return total;
  });
}

export {};

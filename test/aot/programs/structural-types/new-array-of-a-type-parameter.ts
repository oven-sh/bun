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

function make<T>(length: number): T[] {
  return new Array<T>(length);
}

function makeFilled<T>(length: number, value: T): T[] {
  return new Array<T>(length).fill(value);
}

function makeOf<T>(...items: T[]): T[] {
  return new Array<T>(...items);
}

class Point {
  x = 1;
  twice(): number {
    return this.x * 2;
  }
}

function firstPlusOne(numbers: number[]): number {
  return numbers[0] + 1;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += firstPlusOne(makeFilled(2, i)) + makeFilled(3, "s")[2].length + makeFilled(1, new Point())[0].twice();
console.log("2000 honest rounds: " + total);

attempt("numbers", () => [make<number>(2), typeof make<number>(2)[0], firstPlusOne(make<number>(2)), make<number>(2)[0] | 0]);
attempt("numbers: toFixed", () => make<number>(2)[0].toFixed(1));
attempt("numbers: summed by reduce", () => make<number>(3).reduce((a, b) => a + b, 0));
attempt("numbers: summed by for of", () => {
  let sum = 0;
  for (const n of make<number>(3)) sum += n;
  return sum;
});
attempt("numbers: mapped", () => make<number>(2).map(n => n + 1));
attempt("numbers: stored to and read", () => {
  const list = make<number>(3);
  list[1] = 0.5;
  return [list, list[0] + list[1], list[1] + list[1]];
});
attempt("strings", () => [make<string>(2), typeof make<string>(2)[0], make<string>(2)[0] + "!", make<string>(2).join("-")]);
attempt("strings: length", () => make<string>(2)[0].length);
attempt("points", () => [make<Point>(1), typeof make<Point>(1)[0]]);
attempt("points: x", () => make<Point>(1)[0].x);
attempt("points: twice", () => make<Point>(1)[0].twice());
attempt("functions", () => typeof make<() => number>(1)[0]);
attempt("functions: called", () => make<() => number>(1)[0]());
attempt("booleans", () => [make<boolean>(1)[0] ? "truthy" : "falsy", make<boolean>(1)[0] === false]);
attempt("length 0", () => [make<number>(0), make<number>(0).length, typeof make<number>(0)[0]]);
attempt("length -0", () => make<number>(-0).length);
attempt("length 1.5", () => make<number>(1.5));
attempt("length -1", () => make<number>(-1));
attempt("length NaN", () => make<number>(NaN));
attempt("length 2 ** 32", () => make<number>(2 ** 32));
attempt("length 2 ** 32 - 1", () => make<number>(2 ** 32 - 1).length);
attempt("length 2 ** 32 - 1: the last place", () => typeof make<number>(2 ** 32 - 1)[2 ** 32 - 2]);
attempt("one item that is a number is a length", () => makeOf(3));
attempt("one item that is a fraction", () => makeOf(1.5));
attempt("one item that is a string", () => makeOf("3"));
attempt("two items", () => makeOf(3, 4));
attempt("no item", () => makeOf<number>());
attempt("one item that is a number: first + 1", () => firstPlusOne(makeOf(3)));
attempt("Array.of does not do that", () => [Array.of(3), firstPlusOne(Array.of(3))]);

export {};

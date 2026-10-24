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

interface Point {
  x: number;
  y: number;
}

function half(n: number): number {
  return n / 2;
}

function size(s: string): number {
  return s.length;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function total(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

class Counter {
  count = 1;
  add(n: number): number {
    this.count += n;
    return this.count;
  }
}

attempt("honest", () => [half(4), size("ab"), sum({ x: 1, y: 2 }), total([1, 2]), new Counter().add(1), half.call(undefined, 4), size.apply(undefined, ["ab"]), sum.bind(undefined, { x: 1, y: 2 })()]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(i) + size("ab") + sum({ x: i, y: 1 }) + total([i]) + new Counter().add(i) + half.call(undefined, i);
console.log("2000 honest rounds", warm);

attempt("call with a string for a number", () => half.call(undefined, "8"));
attempt("call with nothing", () => half.call(undefined));
attempt("call with null for a string", () => size.call(undefined, null));
attempt("call with a number for a string", () => size.call(undefined, 5));
attempt("call with an array for a string", () => size.call(undefined, ["a", "b", "c"]));
attempt("apply with strings", () => half.apply(undefined, ["8"]));
attempt("apply with an array-like", () => half.apply(undefined, { length: 1, 0: "8" }));
attempt("apply with a string for the list", () => half.apply(undefined, "8"));
attempt("apply with nothing", () => half.apply(undefined));
attempt("bind with a string for a number", () => half.bind(undefined, "8")());
attempt("bind, then called with a string", () => half.bind(undefined)("8"));
attempt("a point with a string inside", () => sum.call(undefined, { x: "1", y: 2 }));
attempt("a point that is a number", () => sum.call(undefined, 5));
attempt("a point that is null", () => sum.call(undefined, null));
attempt("a list that is a string", () => total.call(undefined, "12"));
attempt("a list that is array-like", () => total.apply(undefined, [{ length: 2, 0: 1, 1: 2 }]));
attempt("a list with a hole and a string", () => total.call(undefined, [1, , "3"]));
attempt("a method with another receiver", () => new Counter().add.call({ count: "c" }, 1));
attempt("a method with a primitive receiver", () => new Counter().add.call(5, 1));
attempt("a method with no receiver", () => new Counter().add.call(undefined, 1));
attempt("a method bound to a literal", () => {
  const target = { count: 10 };
  const add = new Counter().add.bind(target);
  return [add(1), add("2"), target.count];
});
attempt("the result is used as its declared type", () => {
  const n: number = half.call(undefined, "x");
  const s: number = size.call(undefined, { length: "long" });
  return [n + 1, s + 1];
});
attempt("honest again", () => [half(4), size("ab"), sum({ x: 1, y: 2 }), total([1, 2]), new Counter().add(1)]);

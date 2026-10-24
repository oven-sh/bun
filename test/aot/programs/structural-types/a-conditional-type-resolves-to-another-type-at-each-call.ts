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

type Element<T> = T extends readonly (infer U)[] ? U : T;
type Result<T> = T extends (...parameters: never[]) => infer R ? R : T;
type Text<T> = T extends number ? string : T extends string ? number : T;

function elementOf<T>(value: T, pick: (value: T) => Element<T>): Element<T> {
  return pick(value);
}

function resultOf<T>(value: T, run: (value: T) => Result<T>): Result<T> {
  return run(value);
}

function turned<T>(value: T, turn: (value: T) => Text<T>): Text<T> {
  return turn(value);
}

function keep<T>(value: T, pick: (value: T) => Element<T>): Element<T>[] {
  const kept: Element<T>[] = [];
  for (let i = 0; i < 3; i++) kept.push(pick(value));
  return kept;
}

class Point {
  x = 2;
  twice(): number {
    return this.x * 2;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) total += elementOf([i, 1], list => list[0]) + elementOf(i, n => n) + resultOf(() => i, f => f()) + turned(i, n => String(n)).length + turned("ab", s => s.length);
console.log("2000 honest rounds: " + total);

attempt("elements", () => [elementOf([1, 2], l => l[1]) + 1, elementOf([0.5], l => l[0]) * 2, elementOf(["a"], l => l[0]).toUpperCase(), elementOf([new Point()], l => l[0]).twice(), elementOf([() => 3], l => l[0])(), elementOf([[1, 2]], l => l[0]).length]);
attempt("what is no list stays what it is", () => [elementOf(1, n => n) + 1, elementOf("ab", s => s).length, elementOf(new Point(), p => p).twice(), elementOf(null, n => n), elementOf(undefined, u => u)]);
attempt("a tuple gives a union", () => elementOf<[number, string]>([1, "a"], t => t[1]));
attempt("an element past the end of numbers", () => elementOf([1, 2], l => l[5]) + 1);
attempt("an element past the end of strings", () => elementOf(["a"], l => l[5]).length);
attempt("an element past the end of points", () => elementOf([new Point()], l => l[5]).twice());
attempt("an element past the end of functions", () => elementOf([() => 3], l => l[5])());
attempt("an element of holes", () => [typeof elementOf(new Array<number>(2), l => l[0]), elementOf(new Array<number>(2), l => l[0]) + 1]);
attempt("kept three times", () => [keep([1, 2], l => l[0]), keep([0.5], l => l[9]), keep("s", s => s), keep(["s"], l => l[0])]);
attempt("kept and summed", () => keep([1, 2], l => l[9]).reduce((a, b) => a + b, 0));
attempt("results", () => [resultOf(() => 1, f => f()) + 1, resultOf(() => "s", f => f()).length, resultOf(5, n => n) + 1, resultOf(() => new Point(), f => f()).twice(), resultOf(() => () => 2, f => f())()]);
attempt("turned", () => [turned(1, n => n.toFixed(1)).length, turned("abc", s => s.length) + 1, turned(true, b => b), turned(null, n => n)]);
attempt("turned at a union: each member by itself", () => {
  const either: number | string = process.argv.length > 0 ? 5 : "five";
  const other = turned<number | string>(either, v => (typeof v === "number" ? v + 1 : v + "!"));
  return [typeof other, other];
});

export {};

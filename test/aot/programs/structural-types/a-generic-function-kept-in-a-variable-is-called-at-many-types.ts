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

const identity = <T,>(value: T): T => value;
const pairOf = <T,>(a: T, b: T): T[] => [a, b];
const firstOf = <T,>(list: T[]): T => list[0];
const lastOf = <T,>(list: T[]): T => list[list.length - 1];
const boxed = <T,>(value: T): { value: T } => ({ value });
const orElse = <T,>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);

class Point {
  x = 1.5;
  twice(): number {
    return this.x * 2;
  }
}

class Tools {
  same: <T>(value: T) => T = identity;
  first: <T>(list: T[]) => T = firstOf;
}

const table: (<T>(list: T[]) => T)[] = [firstOf, lastOf];
const tools = new Tools();
const numbersOnly = identity<number>;
const stringsOnly = identity<string>;

function through<T>(f: <U>(value: U) => U, value: T): T {
  return f(value);
}

let total = 0;
for (let i = 0; i < 2000; i++) total += identity(i) + pairOf(i, 1)[1] + firstOf([i]) + boxed(i).value + orElse(undefined, i);
console.log("2000 rounds with integers: " + total);

attempt("identity", () => [identity(1) + 1, identity(0.5) * 2, identity(-0), identity("s").toUpperCase(), identity(true) ? 1 : 2, identity(null), identity(undefined), identity(10n) + 1n, identity(new Point()).twice(), identity(() => 3)(), identity([1, 2]).length]);
attempt("pairs", () => [pairOf(1, 2), pairOf(1, 0.5), pairOf("a", "b"), pairOf<number | string>(1, "b"), pairOf(new Point(), new Point()).map(p => p.twice()), pairOf(() => 1, () => 2).map(f => f()), pairOf(undefined, undefined), pairOf<number | undefined>(1, undefined)]);
attempt("first", () => [firstOf([1, 2]) + 1, firstOf([0.5]) + 1, firstOf(["a"]).toUpperCase(), firstOf([new Point()]).twice(), firstOf([() => 4])(), firstOf([[1]]).length]);
attempt("first of an empty list of numbers", () => firstOf<number>([]) + 1);
attempt("first of an empty list of strings", () => firstOf<string>([]).length);
attempt("first of an empty list of points", () => firstOf<Point>([]).twice());
attempt("first of an empty list of functions", () => firstOf<() => number>([])());
attempt("last of an empty list", () => typeof lastOf<number>([]));
attempt("first of holes", () => [typeof firstOf(new Array<number>(2)), firstOf(new Array<number>(2)) + 1]);
attempt("boxes", () => [boxed(1), boxed(0.5), boxed("s"), boxed(null), boxed(undefined), boxed([1]), boxed(boxed(1)).value.value + 1]);
attempt("or else", () => [orElse(undefined, 1), orElse(2, 1), orElse<number | null>(null, 1), orElse("", "x"), orElse(0, 1), orElse(NaN, 1)]);
attempt("in a field", () => [tools.same(1) + 1, tools.same("s").length, tools.first([0.5]) * 2, tools.first(["a"]).length]);
attempt("in an array", () => [table[0]([1, 2]) + 1, table[1]([1, 2]) + 1, table[0](["a", "bc"]).length, table[1](["a", "bc"]).length]);
attempt("as an argument", () => [through(identity, 1) + 1, through(identity, "s").length, through(identity, new Point()).twice()]);
attempt("at one type argument", () => [numbersOnly(1) + 1, stringsOnly("s").length, Object.is(numbersOnly, stringsOnly)]);

let changing: <T>(value: T) => T = identity;
const calls: string[] = [];
changing = <T,>(value: T): T => {
  calls.push(typeof value);
  return value;
};
attempt("the variable is stored to", () => [changing(1) + 1, changing("s").length, changing(new Point()).twice(), calls.join()]);
tools.same = changing;
attempt("the field is stored to", () => [tools.same(2) + 1, tools.same("st").length, calls.join()]);

export {};

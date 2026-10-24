function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

let log: string[] = [];
function effect<T>(label: string, value: T): T {
  log.push(label);
  return value;
}

function chain(a: number, b: number = a * 2, c: number = a + b): string {
  return [a, b, c].map(text).join(", ");
}
attempt("chain(1)", () => chain(1));
attempt("chain(1, 5)", () => chain(1, 5));
attempt("chain(1, undefined, 0)", () => chain(1, undefined, 0));
attempt("chain(0.5)", () => chain(0.5));

function ordered(a: number = effect("a", 1), b: number = effect("b", 2), c: number = effect("c", 3)): number {
  log.push("body");
  return a + b + c;
}
for (const [label, run] of [
  ["ordered()", () => ordered()],
  ["ordered(10)", () => ordered(10)],
  ["ordered(undefined, 20)", () => ordered(undefined, 20)],
  ["ordered(10, 20, 30)", () => ordered(10, 20, 30)],
  ["arguments run before defaults", () => ordered(effect("argument a", undefined), effect("argument b", 5))],
] satisfies [string, () => number][]) {
  log = [];
  console.log(label + ": " + run() + " [" + log.join(", ") + "]");
}

let made = 0;
function fresh(list: number[] = (made++, [])): number[] {
  list.push(list.length);
  return list;
}
const first = fresh();
const second = fresh();
attempt("a new list each time", () => [first !== second, fresh(first) === first, made, first, second]);

class Scale {
  factor: number = 3;
  apply(n: number, by: number = this.factor): number {
    return n * by;
  }
  static unit: number = 10;
  static convert(n: number, unit: number = this.unit): number {
    return n * unit;
  }
}
const scale = new Scale();
attempt("a default reads this", () => scale.apply(2));
scale.factor = 5;
attempt("after a store to the field", () => scale.apply(2));
attempt("given, this is not read", () => scale.apply(2, 1));
const detached = scale.apply;
attempt("detached, the default needs this", () => detached(2));
attempt("detached, given", () => detached(2, 4));
attempt("on another receiver", () => scale.apply.call({ factor: 0.5, apply: scale.apply }, 2));
attempt("a static default reads the class", () => Scale.convert(2));
const convert = Scale.convert;
attempt("a detached static", () => convert(2));

function tricky(a: number, bump: () => number = () => ++a, b: number = bump()): string {
  return "a " + a + ", b " + b + ", bump " + bump() + ", a " + a + ", arguments[0] " + text(arguments[0]);
}
attempt("a default changes an earlier parameter", () => tricky(1));
attempt("with its own bump", () => tricky(1, () => 50));

function tooEarly(read: () => number = () => b, a: number = read(), b: number = 1): string {
  return a + " " + b + " " + read();
}
attempt("a default reads a later parameter", () => tooEarly());
attempt("the same, given", () => tooEarly(undefined, 5));

function itself(n: number, next: number = n > 0 ? itself(n - 1) : 100): number {
  return n + next;
}
attempt("a default calls the function itself", () => itself(3));

function explodes(a: number = effect("a", 1), b: number = raise(), c: number = effect("c", 3)): number {
  log.push("body");
  return a + b + c;
}
function raise(): number {
  log.push("raise");
  throw new RangeError("no default");
}
log = [];
attempt("a default throws", () => explodes());
console.log("[" + log.join(", ") + "]");
log = [];
attempt("it is not needed", () => explodes(1, 2));
console.log("[" + log.join(", ") + "]");

let warm = 0;
for (let i = 0; i < 2000; i++) warm += scale.apply(1) + Number(chain(1).length);
console.log("2000 calls: " + warm);
attempt("null is not undefined", () => ((n: number | null = 5): string => text(n))(null));

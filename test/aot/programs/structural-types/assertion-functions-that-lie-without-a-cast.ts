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

class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

class Cat extends Animal {
  lives = "nine";
}

function assertDog(a: Animal): asserts a is Dog {}

function assertNumber(v: number | string | null): asserts v is number {
  if (v === null) throw new RangeError("null");
}

function assertDefined<T>(v: T | undefined | null): asserts v is T {}

function assertTrue(condition: boolean): asserts condition {}

function assertList(v: unknown): asserts v is number[] {}

function legsOf(a: Animal): number {
  assertDog(a);
  return a.legs + 1;
}

function barkOf(a: Animal): number {
  assertDog(a);
  return a.bark();
}

function half(v: number | string | null): number {
  assertNumber(v);
  return v / 2;
}

function added(v: number | string | null): number {
  assertNumber(v);
  return v + 1;
}

function defined(v: number | undefined | null): number {
  assertDefined(v);
  return v + 1;
}

function checked(v: number | string): number {
  assertTrue(typeof v === "number");
  return v + 1;
}

function total(v: unknown): number {
  assertList(v);
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  return sum;
}

class Guarded {
  value: number | string = 1;
  assertNumeric(): asserts this is { value: number } {}
  next(): number {
    this.assertNumeric();
    return this.value + 1;
  }
}

attempt("honest", () => [legsOf(new Dog()), barkOf(new Dog()), half(4), added(1), defined(1), checked(1), total([1, 2]), new Guarded().next()]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += legsOf(new Dog()) + barkOf(new Dog()) + half(i) + added(i) + defined(i) + checked(i) + total([i]) + new Guarded().next();
console.log("2000 honest rounds", warm);

attempt("a cat: a field", () => legsOf(new Cat()));
attempt("a cat: a method", () => barkOf(new Cat()));
attempt("a string: half", () => half("8"));
attempt("a string: added", () => added("8"));
attempt("null throws what the function throws", () => half(null));
attempt("undefined", () => defined(undefined));
attempt("null", () => defined(null));
attempt("a condition that was false", () => checked("8"));
for (const [name, value] of [["a string", "12"], ["an array of strings", ["1", "2"]], ["an array-like", { length: 2, 0: 1, 1: 2 }], ["a set", new Set([1])], ["a number", 5], ["null", null], ["holes", new Array<number>(2)], ["a typed array", new Uint8Array([1, 2])]] satisfies [string, unknown][]) {
  attempt("taken for a list: " + name, () => total(value));
}
attempt("this is asserted", () => {
  const g = new Guarded();
  g.value = "text";
  return g.next();
});
attempt("asserted and then kept in a typed local, a field and an element", () => {
  const a: Animal = new Cat();
  assertDog(a);
  const local: Dog = a;
  const holder: { dog: Dog } = { dog: a };
  const list: Dog[] = [a];
  return [local.legs, holder.dog.legs, list[0].legs, local.name];
});
attempt("asserted once, used in a loop", () => {
  const values: (number | string)[] = [1, 2, "3", 4];
  let sum = 0;
  for (const v of values) {
    assertNumber(v);
    sum += v;
  }
  return sum;
});
attempt("honest again", () => [legsOf(new Dog()), barkOf(new Dog()), half(4), added(1), defined(1), checked(1), total([1, 2])]);

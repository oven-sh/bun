function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + value;
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Dog {
  name: string = "rex";
  legs: number = 4;
  bark(): string {
    return this.name + " barks";
  }
}

function double(n: number): string {
  return "n " + text(n) + ", doubled " + text(n * 2) + ", plus one " + text(n + 1) + ", whole " + text(n | 0);
}

function shout(word: string): string {
  return "word " + text(word) + ", length " + text(word.length) + ", upper " + word.toUpperCase();
}

function walk(dog: Dog): string {
  return "dog " + text(dog) + ", legs " + text(dog.legs) + ", " + dog.bark();
}

function total(list: number[]): string {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return "list " + text(list) + ", length " + text(list.length) + ", sum " + text(sum);
}

function flag(on: boolean): string {
  return "on " + text(on) + ", " + (on ? "yes" : "no") + ", not " + text(!on) + ", is true " + (on === true);
}

const values: [string, unknown][] = [
  ["a number", 3],
  ["a fraction", 0.5],
  ["a text", "text"],
  ["a numeric text", "7"],
  ["undefined", undefined],
  ["null", null],
  ["true", true],
  ["a bigint", 5n],
  ["a dog", new Dog()],
  ["a look-alike", { name: "fake", legs: "many" }],
  ["a list", [1, 2]],
  ["a list of texts", ["a", "b"]],
  ["an array-like", { length: 2, 0: 5, 1: 6 }],
  ["an object with valueOf", { valueOf: () => 9 }],
];

const functions: [string, Function, unknown][] = [
  ["double", double, 2],
  ["shout", shout, "w"],
  ["walk", walk, new Dog()],
  ["total", total, [1, 2, 3]],
  ["flag", flag, false],
];

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += double(i).length + shout("w").length + total([i]).length + flag(i % 2 === 0).length;
console.log("2000 honest calls: " + warm);

for (const [name, f, honest] of functions) {
  attempt(name + ", honest", () => Reflect.apply(f, undefined, [honest]));
  for (const [label, value] of values) attempt(name + ", " + label, () => Reflect.apply(f, undefined, [value]));
  attempt(name + ", nothing", () => Reflect.apply(f, undefined, []));
}

attempt("direct: Reflect.apply(double, undefined, ['7'])", () => Reflect.apply(double, undefined, ["7"]));
attempt("direct: Function.prototype.call.call(double, null, '7')", () => Function.prototype.call.call(double, null, "7"));
attempt("direct: Function.prototype.apply.call(shout, null, [5])", () => Function.prototype.apply.call(shout, null, [5]));
attempt("direct: an array-like of arguments", () => Reflect.apply(double, undefined, { length: 1, 0: "8" }));
attempt("direct: a longer length than members", () => Reflect.apply(double, undefined, { length: 3 }));

const asFunction: Function = walk;
attempt("called as a Function", () => asFunction({ name: "loose", legs: 0, bark: () => "no bark" }));
attempt("called as a Function with a number", () => asFunction(5));
attempt("honest again", () => [double(1), shout("x"), walk(new Dog()), total([1]), flag(true)]);

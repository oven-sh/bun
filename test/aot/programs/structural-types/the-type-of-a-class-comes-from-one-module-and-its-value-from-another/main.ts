import { Dog as Copy } from "./copy/dog";
import type { Dog } from "./dog";
import { adopt, Dog as FromKennel } from "./kennel";
import { describe, isDogByShape } from "./only-the-type";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
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

function which(dog: Dog): string {
  if (dog instanceof Copy) return "the copy: " + dog.tail + " " + dog.bark();
  if (dog instanceof FromKennel) return "the kennel: " + dog.bark();
  return "neither: " + describe(dog) + " " + JSON.stringify(dog);
}

function legsPlusOne(dog: Dog): number {
  return dog.legs + 1;
}

const literal: Dog = { legs: 3, name: "literal", bark: () => "a literal barks" };

let warm = 0;
for (let i = 0; i < 2000; i++) warm += legsPlusOne(adopt("a")) + which(adopt("a")).length + describe(adopt("a")).length;
console.log("2000 honest rounds: " + warm);

attempt("adopted", () => [which(adopt("rex")), legsPlusOne(adopt("rex")), describe(adopt("rex"))]);
attempt("made through the kennel", () => [which(new FromKennel("kay")), new FromKennel("kay") instanceof FromKennel, adopt("x").constructor === FromKennel]);
attempt("the copy under the type of the original", () => [which(new Copy("cop")), legsPlusOne(new Copy("cop")), describe(new Copy("cop")), Object.keys(new Copy("cop")).join()]);
attempt("a literal", () => [which(literal), legsPlusOne(literal), describe(literal)]);
attempt("in one list", () => {
  const dogs: Dog[] = [adopt("a"), new Copy("b"), literal, new FromKennel("c")];
  return [dogs.map(which), dogs.map(legsPlusOne), dogs.filter(dog => dog instanceof FromKennel).length];
});
attempt("a guard by shape", () => {
  const values: unknown[] = [adopt("a"), new Copy("b"), literal, { bark: 5 }, [], null];
  return values.map(value => (isDogByShape(value) ? typeof value.bark + " " + value.legs : "no dog"));
});
attempt("a guard by shape, called", () => {
  const value: unknown = { bark: 5 };
  return isDogByShape(value) ? value.bark() : "no dog";
});

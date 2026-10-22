class Person {
  first: string;
  constructor(first: string) {
    this.first = first;
  }
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs: number = 4;
  tag: string = "rex-tag";
  owner: Person = new Person("ann");
  tricks: string[] = ["sit", "roll"];
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives: string = "nine";
  weight: number = 3.5;
  toys: number[] = [7, 8, 9];
  enemy: Person = new Person("bob");
  purr(): string {
    return this.name + " purrs";
  }
}

class Spider extends Animal {
  legs: string = "eight";
  tag: number = 88;
}

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Anything = number | string | boolean | null | undefined | bigint | symbol | Animal | number[] | (() => number);

interface Wide {
  number(v: Anything): string;
  string(v: Anything): string;
  dog(v: Anything): string;
  array(v: Anything): string;
  func(v: Anything): string;
}

class Careful implements Wide {
  number(n: number): string {
    if (typeof n !== "number") return "not a number: " + typeof n;
    if (n === undefined || n === null) return "nothing";
    if (Number.isNaN(n)) return "NaN";
    if (!Number.isInteger(n)) return "fraction " + n;
    return "whole " + n;
  }
  string(s: string): string {
    if (typeof s !== "string") return "not a string: " + typeof s;
    if (s == null) return "nothing";
    return "string of " + s.length;
  }
  dog(d: Dog): string {
    if (d === null) return "null";
    if (d === undefined) return "undefined";
    if (typeof d !== "object") return "not an object: " + typeof d;
    if (!(d instanceof Animal)) return "not an animal: " + Object.prototype.toString.call(d);
    if (!(d instanceof Dog)) return "an animal but not a dog";
    if (!("legs" in d)) return "a dog without legs";
    if (typeof d.legs !== "number") return "legs are " + typeof d.legs;
    return "dog on " + d.legs;
  }
  array(list: number[]): string {
    if (!Array.isArray(list)) return "not an array: " + typeof list;
    if (list.length === 0) return "empty";
    return "array of " + list.length;
  }
  func(f: () => number): string {
    if (typeof f !== "function") return "not a function: " + typeof f;
    return "function gives " + f();
  }
}

const wide: Wide = new Careful();
const legless = new Dog("legless");
const loose: { legs?: number } = legless;
delete loose.legs;
const wrongLegs = new Dog("wrong");
const wider: { legs: number | string } = wrongLegs;
wider.legs = "four";

const values: [string, Anything][] = [
  ["5", 5],
  ["2.5", 2.5],
  ["NaN", NaN],
  ["'text'", "text"],
  ["''", ""],
  ["true", true],
  ["null", null],
  ["undefined", undefined],
  ["7n", 7n],
  ["symbol", Symbol.iterator],
  ["dog", new Dog("rex")],
  ["cat", new Cat("tom")],
  ["legless dog", legless],
  ["dog with wrong legs", wrongLegs],
  ["literal", { name: "literal" }],
  ["[1]", [1]],
  ["[]", []],
  ["function", () => 3],
];

for (const [label, value] of values) {
  show(label + " as a number", () => wide.number(value));
  show(label + " as a string", () => wide.string(value));
  show(label + " as a dog", () => wide.dog(value));
  show(label + " as an array", () => wide.array(value));
  show(label + " as a function", () => wide.func(value));
}

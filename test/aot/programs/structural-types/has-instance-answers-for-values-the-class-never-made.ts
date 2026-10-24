class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && "name" in value;
  }
}

class Cat extends Animal {
  lives = 9;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function legs(a: Animal): string {
  if (a instanceof Dog) return "dog, legs " + typeof a.legs + " " + a.legs;
  return "no dog: " + a.name;
}

function bark(a: Animal): string {
  if (a instanceof Dog) return a.bark();
  return "silent " + a.name;
}

function double(a: Animal): number {
  return a instanceof Dog ? a.legs * 2 : -1;
}

function store(a: Animal): string {
  if (a instanceof Dog) {
    a.legs = 3;
    return Object.keys(a).join() + " " + JSON.stringify(a);
  }
  return "not stored";
}

function unknownValue(value: unknown): string {
  if (value instanceof Dog) return "dog, legs " + typeof value.legs + ", name " + typeof value.name;
  return "no dog";
}

const dog = new Dog("rex");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += legs(dog).length + bark(dog).length + double(dog);
console.log("2000 honest: " + warm);

const values: [string, () => Animal][] = [
  ["a dog", () => new Dog("rex")],
  ["a cat", () => new Cat("tom")],
  ["an animal", () => new Animal("any")],
  ["a literal", () => ({ name: "literal" })],
];

for (const [label, make] of values) {
  attempt(label + ", legs", () => legs(make()));
  attempt(label + ", bark", () => bark(make()));
  attempt(label + ", double", () => double(make()));
  attempt(label + ", store", () => store(make()));
  attempt(label + ", the real chain", () => Dog.prototype.isPrototypeOf(make()));
}

attempt("unknown: a function with a name", () => unknownValue(function named() {}));
attempt("unknown: an error", () => unknownValue(new Error("e")));
attempt("unknown: a string", () => unknownValue("text"));
attempt("unknown: null", () => unknownValue(null));
attempt("a dog again", () => legs(dog) + " | " + bark(dog) + " | " + double(dog));

export {};

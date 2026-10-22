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

class Claims {
  legs: number = 4;
  tag: string = "claims";
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null;
  }
}

class Never {
  n: number = 1;
  static [Symbol.hasInstance](value: unknown): boolean {
    return false;
  }
}

const BoundDog = Dog.bind(null);
const ProxiedDog = new Proxy(Dog, {});

function legsIfClaims(value: Animal | Claims): string {
  if (value instanceof Claims) return "claims " + typeof value.legs + " " + value.legs + " " + typeof value.tag;
  return "animal " + value.name;
}
function legsIfDog(value: Animal): string {
  if (value instanceof Dog) return "dog " + value.legs + " " + value.bark();
  return "animal " + value.name;
}
function legsIfBound(value: Animal): string {
  if (value instanceof BoundDog) return "dog " + value.legs + " " + value.bark();
  return "animal " + value.name;
}
function legsIfProxied(value: Animal): string {
  if (value instanceof ProxiedDog) return "dog " + value.legs + " " + value.bark();
  return "animal " + value.name;
}
function notNever(value: Never | Cat): string {
  if (value instanceof Never) return "never " + value.n;
  return "cat " + typeof value.lives + " " + value.lives;
}

const relinked: Animal = Object.setPrototypeOf(new Cat("relinked"), Dog.prototype);
const created: Animal = Object.assign(Object.create(Dog.prototype), { name: "created" });
const unlinked: Animal = Object.setPrototypeOf(new Dog("unlinked"), Animal.prototype);

const animals: [string, Animal][] = [
  ["dog", new Dog("rex")],
  ["cat", new Cat("tom")],
  ["a cat relinked to Dog.prototype", relinked],
  ["made from Dog.prototype", created],
  ["a dog relinked to Animal.prototype", unlinked],
  ["literal", { name: "literal" }],
];
for (const [label, animal] of animals) {
  show(label + ": Claims", () => legsIfClaims(animal));
  show(label + ": Dog", () => legsIfDog(animal));
  show(label + ": bound Dog", () => legsIfBound(animal));
  show(label + ": proxied Dog", () => legsIfProxied(animal));
}
show("a real Claims", () => legsIfClaims(new Claims()));
show("a real Never", () => notNever(new Never()));
show("a cat", () => notNever(new Cat("tom")));

function byConstructor(value: Animal): string {
  if (value.constructor === Dog) return "constructor says dog";
  return "constructor says " + value.constructor.name;
}
for (const [label, animal] of animals) show(label + ": constructor", () => byConstructor(animal));

const original = Object.getPrototypeOf(Dog.prototype);
show("the chain of Dog.prototype", () => original === Animal.prototype);
let count = 0;
const rex = new Dog("rex");
for (let i = 0; i < 2000; i++) if (legsIfDog(rex).startsWith("dog")) count++;
show("2000 honest tests", () => count);
show("then the relinked cat", () => legsIfDog(relinked));

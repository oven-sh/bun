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

function swap(x: number): number;
function swap(x: string): string;
function swap(x: number | string): number | string {
  return typeof x === "number" ? "was " + x : x.length;
}

function mate(a: Cat): Cat;
function mate(a: Animal): Dog;
function mate(a: Animal): Animal {
  return a instanceof Cat ? new Cat("kitten") : new Dog("puppy");
}

function find(id: number): Dog;
function find(id: string): Dog | undefined;
function find(id: number | string): Dog | undefined {
  return id === 1 || id === "1" ? new Dog("found") : undefined;
}

function parse(text: string): number;
function parse(text: string, asText: true): string;
function parse(text: string, asText?: boolean): number | string {
  return asText === undefined ? text : Number(text);
}

class Store {
  get(key: "size"): number;
  get(key: "name"): string;
  get(key: string): number | string {
    return key === "size" ? "large" : 12;
  }
  wide(v: number): number;
  wide(v: number, extra?: unknown): unknown {
    return extra === undefined ? v : extra;
  }
}

show("swap a number", () => swap(1));
show("swap a number, then arithmetic", () => swap(1) + 1);
show("swap a number, then toFixed", () => swap(1).toFixed(1));
show("swap a string", () => swap("abc"));
show("swap a string, then length", () => swap("abc").length);
show("swap a string, then upper case", () => swap("abc").toUpperCase());
show("swap a string, then concatenation", () => swap("abc") + "!");

const hidden: Animal = new Cat("tom");
show("mate of a cat seen as a cat", () => mate(new Cat("tom")).lives);
show("mate of a cat seen as an animal: legs", () => mate(hidden).legs);
show("mate of a cat seen as an animal: legs + 1", () => mate(hidden).legs + 1);
show("mate of a cat seen as an animal: tag", () => mate(hidden).tag);
show("mate of a cat seen as an animal: owner", () => mate(hidden).owner.first);
show("mate of a cat seen as an animal: bark", () => mate(hidden).bark());
show("mate of a dog", () => mate(new Dog("rex")).bark());

show("find 1", () => find(1).legs);
show("find 2", () => find(2).legs);
show("find 2, typeof", () => typeof find(2));
show("find '2'", () => find("2")?.legs);

show("parse as a number", () => parse("12") + 1);
show("parse as a number, typeof", () => typeof parse("12"));
show("parse as text", () => parse("12", true).length);
show("parse as text, typeof", () => typeof parse("12", true));

const store = new Store();
show("store size", () => store.get("size") * 2);
show("store size, typeof", () => typeof store.get("size"));
show("store name", () => store.get("name").length);
show("store name, typeof", () => typeof store.get("name"));
show("wide", () => store.wide(3) + 1);
show("wide as a callback", () => [3, 4].map(store.wide).map(v => typeof v + " " + v));

const numbers: number[] = [];
for (let i = 0; i < 3; i++) numbers.push(swap(i));
show("results stored in a number[]", () => numbers.map(n => typeof n).join());
let sum = 0;
for (const n of numbers) sum += n;
show("and summed", () => sum);

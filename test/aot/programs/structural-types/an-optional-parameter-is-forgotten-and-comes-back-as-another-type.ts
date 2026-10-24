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

function visit(times: number, d?: Dog): string {
  if (d === undefined) return "nobody " + times;
  return d.tag + " " + (d.legs + times) + " " + d.owner.first;
}
function count(times: number, d?: Dog): number {
  return d === undefined ? times : d.legs * times;
}
function rename(times: number, d?: Dog): void {
  if (d !== undefined) d.tag = "renamed" + times;
}
function measure(times: number, unit?: string): number {
  return unit === undefined ? times : unit.length * times;
}

const visitShort: (times: number) => string = visit;
const visitCat: (times: number, c?: Cat) => string = visitShort;
const countShort: (times: number) => number = count;
const countCat: (times: number, c?: Cat) => number = countShort;
const countNumber: (times: number, n?: number) => number = countShort;
const renameShort: (times: number) => void = rename;
const renameCat: (times: number, c?: Cat) => void = renameShort;
const measureShort: (times: number) => number = measure;
const measureNumber: (times: number, unit?: number) => number = measureShort;
const measureList: (times: number, unit?: number[]) => number = measureShort;
const measureDog: (times: number, unit?: Dog) => number = measureShort;

const rex = new Dog("rex");
const tom = new Cat("tom");

show("honest visit", () => visit(1, rex));
show("honest visit of nobody", () => visit(1));
show("visit with a cat", () => visitCat(1, tom));
show("visit with no cat", () => visitCat(1));
show("honest count", () => count(2, rex));
show("count with a cat", () => countCat(2, tom));
show("count with a number", () => countNumber(2, 7));
show("count with zero", () => countNumber(2, 0));
show("rename a dog", () => rename(1, rex));
show("rename a cat", () => renameCat(2, tom));
show("the dog afterwards", () => rex);
show("the cat afterwards", () => tom);
show("honest measure", () => measure(2, "cm"));
show("measure with a number", () => measureNumber(2, 7));
show("measure with a list", () => measureList(2, [1, 2, 3]));
show("measure with a dog", () => measureDog(2, rex));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += count(1, rex);
show("2000 honest counts", () => sum);
show("count with a cat after them", () => countCat(2, tom));
show("honest count again", () => count(2, rex));

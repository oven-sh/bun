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

type Visit = { bivarianceHack(a: Animal): number }["bivarianceHack"];
type Name = { bivarianceHack(a: Animal): string }["bivarianceHack"];

function each(list: Animal[], visit: Visit): string {
  const results: string[] = [];
  for (const a of list) {
    try {
      const n: number = visit(a);
      results.push(typeof n + " " + n);
    } catch (error) {
      results.push("threw");
    }
  }
  return results.join(", ");
}

function total(list: Animal[], visit: Visit): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += visit(list[i]);
  return sum;
}

function names(list: Animal[], name: Name): string {
  let all = "";
  for (const a of list) all += name(a) + ";";
  return all;
}

function withVisitor(list: Animal[], visitor: { visit(a: Animal): number }): string {
  return list.map(a => String(visitor.visit(a))).join();
}

const mixed: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing"), new Dog("fido")];
const dogs: Animal[] = [new Dog("a"), new Dog("b"), new Dog("c")];

function legs(d: Dog): number {
  return d.legs;
}

show("dogs, arrow", () => each(dogs, (d: Dog) => d.legs));
show("mixed, arrow", () => each(mixed, (d: Dog) => d.legs));
show("mixed, arithmetic", () => each(mixed, (d: Dog) => d.legs * 2 + 1));
show("mixed, bit operation", () => each(mixed, (d: Dog) => d.legs | 0));
show("mixed, string length", () => each(mixed, (d: Dog) => d.tag.length));
show("mixed, object field", () => each(mixed, (d: Dog) => d.owner.first.length));
show("mixed, array field", () => each(mixed, (d: Dog) => d.tricks.length));
show("mixed, method", () => each(mixed, (d: Dog) => d.bark().length));
show("mixed, store", () => each(mixed, (d: Dog) => (d.legs = 3)));
show("mixed, declared function", () => each(mixed, legs));
show("dogs, total", () => total(dogs, legs));
show("mixed, total", () => total(mixed, legs));
show("honest call of the same function", () => legs(new Dog("direct")));
show("dogs, names", () => names(dogs, (d: Dog) => d.tag));
show("mixed, names", () => names(mixed, (d: Dog) => d.tag));
show("mixed, upper case", () => names(mixed, (d: Dog) => d.tag.toUpperCase()));
show("dogs, visitor", () => withVisitor(dogs, { visit: (d: Dog) => d.legs }));
show("mixed, visitor", () => withVisitor(mixed, { visit: (d: Dog) => d.legs }));
show("mixed afterwards", () => mixed);

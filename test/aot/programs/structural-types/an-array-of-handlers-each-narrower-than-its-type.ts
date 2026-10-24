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

interface Handler {
  handle(a: Animal): string;
  count(a: Animal): number;
}

class DogHandler implements Handler {
  handle(d: Dog): string {
    return "dog " + d.tag + " " + d.bark();
  }
  count(d: Dog): number {
    return d.legs + d.tricks.length;
  }
}

class CatHandler implements Handler {
  handle(c: Cat): string {
    return "cat " + c.lives + " " + c.purr();
  }
  count(c: Cat): number {
    return c.weight + c.toys.length;
  }
}

class SpiderHandler implements Handler {
  handle(s: Spider): string {
    return "spider " + s.legs.toUpperCase();
  }
  count(s: Spider): number {
    return s.tag * 2;
  }
}

const handlers: Handler[] = [new DogHandler(), new CatHandler(), new SpiderHandler()];
const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing")];

for (let h = 0; h < handlers.length; h++) {
  for (let a = 0; a < animals.length; a++) {
    const label = handlers[h].constructor.name + " gets " + animals[a].constructor.name;
    show(label + " handle", () => handlers[h].handle(animals[a]));
    show(label + " count", () => handlers[h].count(animals[a]));
  }
}

show("map over handlers with a cat", () => handlers.map(handler => {
  try {
    return String(handler.count(animals[1]));
  } catch (error) {
    return "threw";
  }
}).join());

let sum = 0;
for (let i = 0; i < 2000; i++) sum += handlers[i % 3].count(animals[i % 3]);
show("2000 matching calls", () => sum);

const sums: string[] = [];
for (let i = 0; i < 12; i++) {
  try {
    sums.push(String(handlers[i % 3].count(animals[i % 4])));
  } catch (error) {
    sums.push("threw");
  }
}
show("12 calls out of step", () => sums.join(" "));

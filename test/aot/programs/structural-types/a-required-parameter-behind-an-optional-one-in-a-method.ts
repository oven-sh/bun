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

interface Walker {
  walk(d: Dog, miles?: number): number;
  call(d: Dog, word?: string): string;
  pair(d: Dog, friend?: Dog): number;
  list(d: Dog, extra?: string[]): number;
  then(d: Dog, after?: () => string): string;
}

class StrictWalker implements Walker {
  total: number = 0;
  walk(d: Dog, miles: number): number {
    this.total += miles;
    return d.legs * miles;
  }
  call(d: Dog, word: string): string {
    return d.name + " " + word.toUpperCase();
  }
  pair(d: Dog, friend: Dog): number {
    return d.legs + friend.legs;
  }
  list(d: Dog, extra: string[]): number {
    return d.tricks.length + extra.length;
  }
  then(d: Dog, after: () => string): string {
    return d.name + after();
  }
}

const own = new StrictWalker();
const walker: Walker = own;
const rex = new Dog("rex");

show("typed walk", () => own.walk(rex, 2));
show("typed call", () => own.call(rex, "come"));
show("typed pair", () => own.pair(rex, rex));
show("typed list", () => own.list(rex, ["x"]));
show("typed then", () => own.then(rex, () => "!"));
show("total", () => own.total);

show("walk with miles", () => walker.walk(rex, 3));
show("walk without", () => walker.walk(rex));
show("walk with undefined", () => walker.walk(rex, undefined));
show("total after a walk without miles", () => own.total);
show("typeof total", () => typeof own.total);
show("call without", () => walker.call(rex));
show("pair without", () => walker.pair(rex));
show("list without", () => walker.list(rex));
show("then without", () => walker.then(rex));

own.total = 0;
for (let i = 0; i < 2000; i++) walker.walk(rex, 1);
show("2000 walks with miles", () => own.total);
walker.walk(rex);
show("one more without", () => own.total);
own.total = 5;
show("typed walk again", () => own.walk(rex, 2));
show("total again", () => own.total);

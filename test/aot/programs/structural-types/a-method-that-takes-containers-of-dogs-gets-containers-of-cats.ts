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

interface Wide {
  list(v: Animal[]): string;
  legsTotal(v: Animal[]): number;
  map(v: Map<string, Animal>): string;
  set(v: Set<Animal>): string;
  home(v: { pet: Animal }): string;
  deep(v: { home: { pet: Animal } }): string;
  maker(v: () => Animal): string;
  pair(v: [Animal, Animal]): string;
  record(v: Record<string, Animal>): string;
  later(v: Promise<Animal>): Promise<string>;
  closure(v: Animal): () => string;
}

function about(d: Dog): string {
  let bark: string;
  try {
    bark = d.bark();
  } catch (error) {
    bark = "no bark";
  }
  return typeof d.legs + " " + d.legs + " " + typeof d.tag + " " + typeof d.owner + " " + bark;
}

class Narrow implements Wide {
  list(dogs: Dog[]): string {
    return dogs.map(about).join("; ");
  }
  legsTotal(dogs: Dog[]): number {
    let total = 0;
    for (const d of dogs) total += d.legs;
    return total;
  }
  map(dogs: Map<string, Dog>): string {
    const out: string[] = [];
    for (const [key, d] of dogs) out.push(key + " " + about(d));
    return out.join("; ");
  }
  set(dogs: Set<Dog>): string {
    return [...dogs].map(about).join("; ");
  }
  home(home: { pet: Dog }): string {
    return about(home.pet);
  }
  deep(v: { home: { pet: Dog } }): string {
    return typeof v.home.pet.legs + " " + (v.home.pet.legs + 1);
  }
  maker(make: () => Dog): string {
    return about(make());
  }
  pair([first, second]: [Dog, Dog]): string {
    return about(first) + "; " + about(second);
  }
  record(dogs: Record<string, Dog>): string {
    return Object.keys(dogs).map(key => key + " " + about(dogs[key])).join("; ");
  }
  async later(dog: Promise<Dog>): Promise<string> {
    return about(await dog);
  }
  closure(d: Dog): () => string {
    return () => about(d);
  }
}

const wide: Wide = new Narrow();
const rex = new Dog("rex");
const tom = new Cat("tom");
const boris = new Spider("boris");

show("list of dogs", () => wide.list([rex, rex]));
show("list with a cat", () => wide.list([rex, tom, boris]));
show("legs of dogs", () => wide.legsTotal([rex, rex]));
show("legs with a cat", () => wide.legsTotal([rex, tom]));
show("legs with a spider", () => wide.legsTotal([rex, boris]));
show("map of dogs", () => wide.map(new Map([["r", rex]])));
show("map with a cat", () => wide.map(new Map<string, Animal>([["r", rex], ["t", tom]])));
show("set with a cat", () => wide.set(new Set<Animal>([rex, tom])));
show("home of a dog", () => wide.home({ pet: rex }));
show("home of a cat", () => wide.home({ pet: tom }));
show("deep home of a dog", () => wide.deep({ home: { pet: rex } }));
show("deep home of a cat", () => wide.deep({ home: { pet: tom } }));
show("deep home of a spider", () => wide.deep({ home: { pet: boris } }));
show("maker of a dog", () => wide.maker(() => rex));
show("maker of a cat", () => wide.maker(() => tom));
show("pair", () => wide.pair([tom, rex]));
show("record", () => wide.record({ r: rex, t: tom }));
const dogClosure = wide.closure(rex);
const catClosure = wide.closure(tom);
show("closure over a dog", dogClosure);
show("closure over a cat", catClosure);
show("closure over a dog again", dogClosure);
show("honest call of the helper", () => about(rex));

wide.later(Promise.resolve(rex)).then(result => {
  console.log("promise of a dog: " + result);
  return wide.later(Promise.resolve(tom));
}).then(result => console.log("promise of a cat: " + result));

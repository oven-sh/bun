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

abstract class Keeper {
  abstract legsOf(a: Animal): number;
  abstract tagOf(a: Animal): string;
  abstract ownerOf(a: Animal): Person;
  abstract speak(a: Animal): string;
  abstract shoe(a: Animal, legs: number): void;
  report(a: Animal): string {
    return "legs " + this.legsOf(a) + ", tag " + this.tagOf(a);
  }
  doubled(a: Animal): number {
    const legs: number = this.legsOf(a);
    return legs * 2;
  }
  shout(a: Animal): string {
    const tag: string = this.tagOf(a);
    return tag.toUpperCase();
  }
  greet(a: Animal): string {
    const owner: Person = this.ownerOf(a);
    return "hello " + owner.first;
  }
}

class DogKeeper extends Keeper {
  legsOf(d: Dog): number {
    return d.legs;
  }
  tagOf(d: Dog): string {
    return d.tag;
  }
  ownerOf(d: Dog): Person {
    return d.owner;
  }
  speak(d: Dog): string {
    return d.bark();
  }
  shoe(d: Dog, legs: number): void {
    d.legs = legs;
  }
}

const own = new DogKeeper();
const keeper: Keeper = own;

function all(kind: string, a: Animal): void {
  show(kind + " legsOf", () => keeper.legsOf(a));
  show(kind + " tagOf", () => keeper.tagOf(a));
  show(kind + " ownerOf", () => keeper.ownerOf(a));
  show(kind + " speak", () => keeper.speak(a));
  show(kind + " report", () => keeper.report(a));
  show(kind + " doubled", () => keeper.doubled(a));
  show(kind + " shout", () => keeper.shout(a));
  show(kind + " greet", () => keeper.greet(a));
  show(kind + " shoe", () => keeper.shoe(a, 6));
  show(kind + " legsOf after shoe", () => keeper.legsOf(a));
  show(kind + " afterwards", () => a);
}

const rex = new Dog("rex");
show("typed caller legsOf", () => own.legsOf(rex));
show("typed caller speak", () => own.speak(rex));
all("dog", rex);
all("cat", new Cat("tom"));
all("animal", new Animal("thing"));
all("spider", new Spider("boris"));
all("dog again", new Dog("fido"));
show("typed caller doubled", () => own.doubled(rex));

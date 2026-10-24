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

class Shop {
  static price(a: Animal): number {
    return a.name.length;
  }
  static label(a: Animal): string {
    return a.name;
  }
  static both(a: Animal): string {
    return this.label(a) + " costs " + this.price(a);
  }
}

class DogShop extends Shop {
  static price(d: Dog): number {
    return d.legs * 25;
  }
  static label(d: Dog): string {
    return d.tag + " of " + d.owner.first;
  }
}

const shops: (typeof Shop)[] = [Shop, DogShop];
const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing")];

for (const shop of shops) {
  for (const animal of animals) {
    const label = shop.name + " " + animal.constructor.name;
    show(label + " price", () => shop.price(animal));
    show(label + " label", () => shop.label(animal));
    show(label + " both", () => shop.both(animal));
  }
}

const chosen: typeof Shop = DogShop;
show("direct price of a cat", () => chosen.price(new Cat("direct")));
show("honest price", () => DogShop.price(new Dog("honest")));
show("honest both", () => DogShop.both(new Dog("honest")));
show("both of a cat, on the subclass itself", () => DogShop.both(new Cat("sly")));

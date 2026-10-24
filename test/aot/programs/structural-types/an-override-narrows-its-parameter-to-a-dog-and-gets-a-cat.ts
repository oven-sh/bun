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

class Keeper {
  weigh(a: Animal): number {
    return a.name.length;
  }
  describe(a: Animal): string {
    return "an animal called " + a.name;
  }
  adopt(a: Animal): void {
    a.name = a.name + "!";
  }
  weighTwice(a: Animal): number {
    return this.weigh(a) + this.weigh(a);
  }
}

class DogKeeper extends Keeper {
  weigh(d: Dog): number {
    return d.legs * 10;
  }
  describe(d: Dog): string {
    return super.describe(d) + " with tag " + d.tag + " of " + d.owner.first;
  }
  adopt(d: Dog): void {
    super.adopt(d);
    d.tricks.push("stay");
  }
}

class PuppyKeeper extends DogKeeper {
  weigh(d: Dog): number {
    return super.weigh(d) / 4;
  }
}

const keepers: Keeper[] = [new Keeper(), new DogKeeper(), new PuppyKeeper()];
const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Animal("thing"), new Spider("boris")];

for (const keeper of keepers) {
  for (const animal of animals) {
    const label = keeper.constructor.name + " " + animal.constructor.name;
    show(label + " weigh", () => keeper.weigh(animal));
    show(label + " weighTwice", () => keeper.weighTwice(animal));
    show(label + " describe", () => keeper.describe(animal));
    show(label + " adopt", () => keeper.adopt(animal));
    show(label + " afterwards", () => animal);
  }
}

function weighWith(keeper: Keeper, animal: Animal): number {
  return keeper.weigh(animal);
}

let total = 0;
const dogKeeper = new DogKeeper();
const dog = new Dog("loop");
for (let i = 0; i < 2000; i++) total += weighWith(dogKeeper, dog);
show("2000 dogs", () => total);
show("then a cat", () => weighWith(dogKeeper, new Cat("late")));
show("then a spider", () => weighWith(dogKeeper, new Spider("late")));
show("then a dog", () => weighWith(dogKeeper, dog));

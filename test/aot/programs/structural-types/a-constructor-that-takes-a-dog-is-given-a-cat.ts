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

class Yard {
  size: number;
  constructor(a: Animal) {
    this.size = a.name.length;
  }
  describe(): string {
    return "yard " + this.size;
  }
}

class DogYard extends Yard {
  legs: number;
  tag: string;
  owner: Person;
  constructor(d: Dog) {
    super(d);
    this.legs = d.legs;
    this.tag = d.tag;
    this.owner = d.owner;
  }
  describe(): string {
    return "dog yard " + this.size + " " + this.legs + " " + this.tag;
  }
}

class LoudYard extends Yard {
  sound: string;
  constructor(public d: Dog) {
    super(d);
    this.sound = d.bark();
  }
}

function build(Make: typeof Yard, a: Animal): Yard {
  return new Make(a);
}

const makers: (typeof Yard)[] = [Yard, DogYard, LoudYard];
const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing")];

for (const Make of makers) {
  for (const animal of animals) {
    const label = Make.name + " of " + animal.constructor.name;
    show(label, () => build(Make, animal));
    show(label + " describe", () => build(Make, animal).describe());
  }
}

const Chosen: typeof Yard = DogYard;
const built = new Chosen(new Cat("direct"));
show("direct", () => built);
if (built instanceof DogYard) {
  show("legs", () => built.legs);
  show("legs + 1", () => built.legs + 1);
  show("tag", () => built.tag);
  show("tag length", () => built.tag.length);
  show("owner", () => built.owner);
  show("owner's name", () => built.owner.first);
  show("keys", () => Object.keys(built).join());
}

show("honest", () => new DogYard(new Dog("honest")).describe());
let sum = 0;
for (let i = 0; i < 2000; i++) sum += new DogYard(animals[0] instanceof Dog ? animals[0] : new Dog("never")).legs;
show("2000 honest constructions", () => sum);
show("a cat after them", () => build(DogYard, animals[1]).describe());
show("by Reflect.construct", () => Reflect.construct(Chosen, [new Cat("reflected")]).describe());

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

const spare = new Dog("spare");

interface Keeper {
  parts(a: Animal): string;
  nested(a: Animal): string;
  withDefaults(a: Animal): string;
  firstTrick(a: Animal): string;
  others(a: Animal): string;
  orSpare(a?: Animal): number;
}

class DogKeeper implements Keeper {
  parts({ legs, tag }: Dog): string {
    return typeof legs + " " + legs + " " + typeof tag + " " + tag;
  }
  nested({ owner: { first } }: Dog): string {
    return first;
  }
  withDefaults({ legs = -1, tag = "no tag" }: Dog): string {
    return legs + " " + tag;
  }
  firstTrick({ tricks: [first] }: Dog): string {
    return first;
  }
  others({ name, ...rest }: Dog): string {
    return name + ": " + Object.keys(rest).join();
  }
  orSpare(d: Dog = spare): number {
    return d.legs;
  }
}

const keeper: Keeper = new DogKeeper();
const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing"), { name: "literal" }];
for (const animal of animals) {
  const kind = animal.constructor.name;
  show(kind + " parts", () => keeper.parts(animal));
  show(kind + " nested", () => keeper.nested(animal));
  show(kind + " withDefaults", () => keeper.withDefaults(animal));
  show(kind + " firstTrick", () => keeper.firstTrick(animal));
  show(kind + " others", () => keeper.others(animal));
  show(kind + " orSpare", () => keeper.orSpare(animal));
}
show("nobody orSpare", () => keeper.orSpare());
show("undefined orSpare", () => keeper.orSpare(undefined));

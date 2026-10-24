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

type Wide = Animal | null | undefined | string | number;

interface Keeper {
  parts(a: Wide): string;
  nested(a: Wide): string;
  withDefaults(a: Wide): string;
  nothing(a: Wide): string;
  others(a: Wide): string;
  inBody(a: Wide): string;
  list(a: Wide[]): string;
}

class DogKeeper implements Keeper {
  parts({ legs, tag }: Dog): string {
    return typeof legs + " " + typeof tag;
  }
  nested({ owner: { first } }: Dog): string {
    return typeof first;
  }
  withDefaults({ legs = -1, name = "no name" }: Dog): string {
    return legs + " " + name;
  }
  nothing({}: Dog): string {
    return "took nothing";
  }
  others({ name, ...rest }: Dog): string {
    return typeof name + " " + Object.keys(rest).join("+");
  }
  inBody(d: Dog): string {
    const { legs } = d;
    return typeof legs;
  }
  list([first, second]: Dog[]): string {
    return typeof first + " " + typeof second;
  }
}

const keeper: Keeper = new DogKeeper();
const values: [string, Wide][] = [
  ["dog", new Dog("rex")],
  ["null", null],
  ["undefined", undefined],
  ["string", "text"],
  ["number", 5],
  ["cat", new Cat("tom")],
];
for (const [label, value] of values) {
  show(label + " parts", () => keeper.parts(value));
  show(label + " nested", () => keeper.nested(value));
  show(label + " withDefaults", () => keeper.withDefaults(value));
  show(label + " nothing", () => keeper.nothing(value));
  show(label + " others", () => keeper.others(value));
  show(label + " inBody", () => keeper.inBody(value));
}
show("list of two", () => keeper.list([new Dog("a"), null]));
show("list of none", () => keeper.list([]));
show("list of strings", () => keeper.list(["x", 5]));

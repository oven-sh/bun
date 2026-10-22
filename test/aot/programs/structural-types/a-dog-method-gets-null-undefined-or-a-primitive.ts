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

type Wide = Animal | null | undefined | string | number | boolean;

interface Keeper {
  legsOf(a: Wide): number;
  nameOf(a: Wide): string;
  tagLength(a: Wide): number;
  speak(a: Wide): string;
  shoe(a: Wide): void;
  isDog(a: Wide): boolean;
  exists(a: Wide): boolean;
  kind(a: Wide): string;
  chained(a: Wide): number | undefined;
  keep(a: Wide): void;
}

class DogKeeper implements Keeper {
  kept: Dog = new Dog("kept");
  legsOf(d: Dog): number {
    return d.legs;
  }
  nameOf(d: Dog): string {
    return d.name;
  }
  tagLength(d: Dog): number {
    return d.tag.length;
  }
  speak(d: Dog): string {
    return d.bark();
  }
  shoe(d: Dog): void {
    d.legs = 6;
  }
  isDog(d: Dog): boolean {
    return d instanceof Dog;
  }
  exists(d: Dog): boolean {
    return d ? true : false;
  }
  kind(d: Dog): string {
    return typeof d;
  }
  chained(d: Dog): number | undefined {
    return d?.legs;
  }
  keep(d: Dog): void {
    this.kept = d;
  }
}

const own = new DogKeeper();
const keeper: Keeper = own;
const values: [string, Wide][] = [
  ["dog", new Dog("rex")],
  ["null", null],
  ["undefined", undefined],
  ["string", "text"],
  ["empty string", ""],
  ["number", 5],
  ["zero", 0],
  ["true", true],
  ["false", false],
  ["dog again", new Dog("fido")],
];

for (const [label, value] of values) {
  show(label + " legsOf", () => keeper.legsOf(value));
  show(label + " nameOf", () => keeper.nameOf(value));
  show(label + " tagLength", () => keeper.tagLength(value));
  show(label + " speak", () => keeper.speak(value));
  show(label + " shoe", () => keeper.shoe(value));
  show(label + " isDog", () => keeper.isDog(value));
  show(label + " exists", () => keeper.exists(value));
  show(label + " kind", () => keeper.kind(value));
  show(label + " chained", () => keeper.chained(value));
  show(label + " keep", () => keeper.keep(value));
  show(label + " kept", () => typeof own.kept);
  show(label + " kept legs", () => own.kept.legs);
}

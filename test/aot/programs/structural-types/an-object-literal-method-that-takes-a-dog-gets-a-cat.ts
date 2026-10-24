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

interface Keeper {
  legsOf(a: Animal): number;
  tagOf(a: Animal): string;
  ownerName(a: Animal): string;
  speak(a: Animal): string;
  shoe(a: Animal): void;
}

const shorthand: Keeper = {
  legsOf(d: Dog) {
    return d.legs;
  },
  tagOf(d: Dog) {
    return d.tag;
  },
  ownerName(d: Dog) {
    return d.owner.first;
  },
  speak(d: Dog) {
    return d.bark();
  },
  shoe(d: Dog) {
    d.legs = d.legs + 1;
  },
};

const arrows: Keeper = {
  legsOf: (d: Dog) => d.legs,
  tagOf: (d: Dog) => d.tag,
  ownerName: (d: Dog) => d.owner.first,
  speak: (d: Dog) => d.bark(),
  shoe: (d: Dog) => {
    d.legs += 1;
  },
};

function legsOfDog(d: Dog): number {
  return d.legs;
}
function tagOfDog(d: Dog): string {
  return d.tag;
}
function ownerNameOfDog(d: Dog): string {
  return d.owner.first;
}
function speakDog(d: Dog): string {
  return d.bark();
}
function shoeDog(d: Dog): void {
  d.legs++;
}

const declared: Keeper = {
  legsOf: legsOfDog,
  tagOf: tagOfDog,
  ownerName: ownerNameOfDog,
  speak: speakDog,
  shoe: shoeDog,
};

function all(kind: string, keeper: Keeper, a: Animal): void {
  show(kind + " legsOf", () => keeper.legsOf(a));
  show(kind + " tagOf", () => keeper.tagOf(a));
  show(kind + " ownerName", () => keeper.ownerName(a));
  show(kind + " speak", () => keeper.speak(a));
  show(kind + " shoe", () => keeper.shoe(a));
  show(kind + " afterwards", () => a);
}

const forms: [string, Keeper][] = [
  ["shorthand", shorthand],
  ["arrows", arrows],
  ["declared", declared],
];
for (const [form, keeper] of forms) {
  all(form + " dog", keeper, new Dog("rex"));
  all(form + " cat", keeper, new Cat("tom"));
  all(form + " animal", keeper, new Animal("thing"));
  all(form + " spider", keeper, new Spider("boris"));
}

const honest = new Dog("honest");
show("the same function called honestly: legs", () => legsOfDog(honest));
show("the same function called honestly: tag", () => tagOfDog(honest));
show("the same function called honestly: owner", () => ownerNameOfDog(honest));
show("the same function called honestly: speak", () => speakDog(honest));
show("the same function called honestly: shoe", () => shoeDog(honest));
show("honest afterwards", () => honest);

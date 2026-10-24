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

const log: string[] = [];

class Wolf extends Animal {
  pack: string = "grey";
  tricks: string[] = ["howl"];
  owner: Person = new Person("nobody");
  tag: string = "wolf-tag";
  legs: number = 40;
  bark(): string {
    return this.name + " howls on " + this.legs;
  }
}

class Robot extends Animal {
  get legs(): number {
    log.push("get legs");
    return 2;
  }
  set legs(n: number) {
    log.push("set legs " + n);
  }
  get tag(): string {
    log.push("get tag");
    return "robot-tag";
  }
  get owner(): Person {
    log.push("get owner");
    return new Person("maker");
  }
  get tricks(): string[] {
    log.push("get tricks");
    return [];
  }
  get bark(): () => string {
    log.push("get bark");
    return () => "beep";
  }
}

class Broken extends Animal {
  get legs(): number {
    throw new RangeError("no legs");
  }
}

interface Keeper {
  legsOf(a: Animal): number;
  tagOf(a: Animal): string;
  ownerName(a: Animal): string;
  speak(a: Animal): string;
  shoe(a: Animal): void;
}

class DogKeeper implements Keeper {
  legsOf(d: Dog): number {
    return d.legs;
  }
  tagOf(d: Dog): string {
    return d.tag;
  }
  ownerName(d: Dog): string {
    return d.owner.first;
  }
  speak(d: Dog): string {
    return d.bark();
  }
  shoe(d: Dog): void {
    d.legs = 6;
  }
}

const own = new DogKeeper();
const keeper: Keeper = own;
const inherited: Animal = Object.create(new Dog("parent"));
const proxied: Animal = new Proxy(new Dog("behind a proxy"), {
  get(target, key, receiver) {
    log.push("trap get " + String(key));
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    log.push("trap set " + String(key));
    return Reflect.set(target, key, value, receiver);
  },
});
const frozen: Animal = Object.freeze(new Dog("frozen"));

const animals: [string, Animal][] = [
  ["dog", new Dog("rex")],
  ["wolf", new Wolf("grey")],
  ["robot", new Robot("r2")],
  ["broken", new Broken("b")],
  ["inherited", inherited],
  ["proxied", proxied],
  ["frozen", frozen],
  ["dog again", new Dog("fido")],
];

for (const [kind, a] of animals) {
  show(kind + " legsOf", () => keeper.legsOf(a));
  show(kind + " tagOf", () => keeper.tagOf(a));
  show(kind + " ownerName", () => keeper.ownerName(a));
  show(kind + " speak", () => keeper.speak(a));
  show(kind + " shoe", () => keeper.shoe(a));
  show(kind + " legsOf after shoe", () => keeper.legsOf(a));
  show(kind + " own keys", () => Object.keys(a).join());
  show(kind + " log", () => log.splice(0).join(" | "));
}

const wolfAsDog: Dog = new Wolf("typed as a dog");
show("a wolf typed as a dog, typed caller: legs", () => own.legsOf(wolfAsDog));
show("a wolf typed as a dog, typed caller: tag", () => own.tagOf(wolfAsDog));
show("a wolf typed as a dog, typed caller: owner", () => own.ownerName(wolfAsDog));
show("a wolf typed as a dog, typed caller: speak", () => own.speak(wolfAsDog));
const robotAsDog: Dog = new Robot("typed as a dog");
show("a robot typed as a dog, typed caller: legs", () => own.legsOf(robotAsDog));
show("a robot typed as a dog, typed caller: speak", () => own.speak(robotAsDog));
show("log", () => log.splice(0).join(" | "));

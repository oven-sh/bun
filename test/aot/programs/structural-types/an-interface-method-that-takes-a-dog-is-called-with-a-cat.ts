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

interface Keeper {
  legsOf(a: Animal): number;
  legsPlusOne(a: Animal): number;
  tagOf(a: Animal): string;
  tagLength(a: Animal): number;
  ownerOf(a: Animal): Person;
  ownerName(a: Animal): string;
  trickCount(a: Animal): number;
  speak(a: Animal): string;
  shoe(a: Animal): void;
  label(a: Animal): void;
}

class DogKeeper implements Keeper {
  legsOf(d: Dog): number {
    return d.legs;
  }
  legsPlusOne(d: Dog): number {
    return d.legs + 1;
  }
  tagOf(d: Dog): string {
    return d.tag;
  }
  tagLength(d: Dog): number {
    return d.tag.length;
  }
  ownerOf(d: Dog): Person {
    return d.owner;
  }
  ownerName(d: Dog): string {
    return d.owner.first;
  }
  trickCount(d: Dog): number {
    return d.tricks.length;
  }
  speak(d: Dog): string {
    return d.bark();
  }
  shoe(d: Dog): void {
    d.legs = 5;
  }
  label(d: Dog): void {
    d.tag = "labeled";
  }
}

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
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

const keeper: Keeper = new DogKeeper();

function all(kind: string, a: Animal): void {
  show(kind + " legsOf", () => keeper.legsOf(a));
  show(kind + " legsPlusOne", () => keeper.legsPlusOne(a));
  show(kind + " tagOf", () => keeper.tagOf(a));
  show(kind + " tagLength", () => keeper.tagLength(a));
  show(kind + " ownerOf", () => keeper.ownerOf(a));
  show(kind + " ownerName", () => keeper.ownerName(a));
  show(kind + " trickCount", () => keeper.trickCount(a));
  show(kind + " speak", () => keeper.speak(a));
  show(kind + " shoe", () => keeper.shoe(a));
  show(kind + " label", () => keeper.label(a));
  show(kind + " afterwards", () => a);
  show(kind + " keys", () => Object.keys(a).join());
}

all("dog", new Dog("rex"));
all("cat", new Cat("tom"));
all("animal", new Animal("thing"));
all("spider", new Spider("boris"));
all("literal", { name: "made by hand" });
all("dog again", new Dog("fido"));

const cat = new Cat("direct");
show("direct cat legsOf", () => keeper.legsOf(cat));
show("direct cat legsPlusOne", () => keeper.legsPlusOne(cat));
show("direct cat tagLength", () => keeper.tagLength(cat));
show("direct cat ownerName", () => keeper.ownerName(cat));
show("direct cat speak", () => keeper.speak(cat));
keeper.shoe(cat);
keeper.label(cat);
show("direct cat lives", () => cat.lives);
show("direct cat weight", () => cat.weight);
show("direct cat toys", () => cat.toys);
show("direct cat enemy", () => cat.enemy);
show("direct cat purr", () => cat.purr());
show("direct cat whole", () => cat);

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

function legs(this: Dog): number {
  return this.legs;
}
function tag(this: Dog): string {
  return this.tag;
}
function owner(this: Dog): string {
  return this.owner.first;
}
function speak(this: Dog): string {
  return this.bark();
}
function shoe(this: Dog, n: number): void {
  this.legs = n;
}
function kind(this: Dog): string {
  return typeof this;
}

const freeLegs: () => number = legs;
const freeTag: () => string = tag;
const freeOwner: () => string = owner;
const freeSpeak: () => string = speak;
const freeShoe: (n: number) => void = shoe;
const freeKind: () => string = kind;

const rex = new Dog("rex");
show("honest legs", () => legs.call(rex));
show("honest tag", () => tag.call(rex));
show("honest owner", () => owner.call(rex));
show("honest speak", () => speak.call(rex));
show("honest shoe", () => shoe.call(rex, 3));
show("honest legs after", () => legs.call(rex));

show("free legs", () => freeLegs());
show("free tag", () => freeTag());
show("free owner", () => freeOwner());
show("free speak", () => freeSpeak());
show("free shoe", () => freeShoe(2));
show("free kind", () => freeKind());

const onCat = { cat: new Cat("tom"), legs: freeLegs, tag: freeTag, owner: freeOwner, speak: freeSpeak, shoe: freeShoe, kind: freeKind };
show("as a member of another object: legs", () => onCat.legs());
show("as a member of another object: tag", () => onCat.tag());
show("as a member of another object: owner", () => onCat.owner());
show("as a member of another object: speak", () => onCat.speak());
show("as a member of another object: kind", () => onCat.kind());
show("as a member of another object: shoe", () => onCat.shoe(7));
show("what legs is now", () => typeof onCat.legs);

class Kennel {
  legs: string = "none";
  tag: number = 1;
  read: () => number = freeLegs;
  label: () => string = freeTag;
}
const kennel = new Kennel();
show("as a field of a class: legs", () => kennel.read());
show("as a field of a class: tag", () => kennel.label());

show("handed to map", () => [1, 2].map(freeLegs));
show("handed to map with a cat as this", () => [1, 2].map(freeLegs, new Cat("tom")));
show("handed to map with a spider as this", () => [1, 2].map(freeLegs, new Spider("boris")));
show("handed to map with a dog as this", () => [1, 2].map(freeLegs, rex));

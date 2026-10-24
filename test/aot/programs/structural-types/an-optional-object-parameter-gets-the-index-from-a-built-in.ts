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

function legsWith(d: Dog, friend?: Dog): number {
  return friend === undefined ? d.legs : d.legs + friend.legs;
}
function tagWith(d: Dog, friend?: Dog): string {
  return friend ? d.tag + "+" + friend.tag : d.tag;
}
function ownerWith(d: Dog, friend?: Dog): string {
  return d.owner.first + "+" + (friend === undefined ? "nobody" : friend.owner.first);
}
function barkWith(d: Dog, friend?: Dog): string {
  return friend === undefined ? d.bark() : friend.bark();
}
function chained(d: Dog, friend?: Dog): string {
  return typeof friend + " " + friend?.legs + " " + friend?.owner?.first;
}
function callWith(d: Dog, after?: () => string): string {
  return after === undefined ? d.name : d.name + after();
}
function listWith(d: Dog, more?: string[]): number {
  return d.tricks.length + (more === undefined ? 0 : more.length);
}
function storeWith(d: Dog, friend?: Dog): number {
  if (friend !== undefined) friend.legs = 1;
  return d.legs;
}

const legsShort: (d: Dog) => number = legsWith;
const tagShort: (d: Dog) => string = tagWith;
const ownerShort: (d: Dog) => string = ownerWith;
const barkShort: (d: Dog) => string = barkWith;
const chainedShort: (d: Dog) => string = chained;
const callShort: (d: Dog) => string = callWith;
const listShort: (d: Dog) => number = listWith;
const storeShort: (d: Dog) => number = storeWith;

const dogs = [new Dog("rex"), new Dog("fido"), new Dog("spot")];

show("honest legs", () => legsWith(dogs[0], dogs[1]));
show("honest tag", () => tagWith(dogs[0], dogs[1]));
show("honest owner", () => ownerWith(dogs[0], dogs[1]));
show("honest bark", () => barkWith(dogs[0], dogs[1]));
show("honest call", () => callWith(dogs[0], () => "!"));
show("honest list", () => listWith(dogs[0], ["x"]));
show("short legs", () => legsShort(dogs[0]));

show("map legs", () => dogs.map(legsShort));
show("map tag", () => dogs.map(tagShort));
show("map owner", () => dogs.map(ownerShort));
show("map bark", () => dogs.map(barkShort));
show("map chained", () => dogs.map(chainedShort));
show("map call", () => dogs.map(callShort));
show("map list", () => dogs.map(listShort));
show("map store", () => dogs.map(storeShort));
show("set forEach: the friend is the dog itself", () => {
  const out: string[] = [];
  new Set(dogs).forEach((d: Dog) => out.push(tagShort(d)));
  new Set(dogs).forEach(d => out.push(String(legsShort(d))));
  return out;
});
show("set forEach handed the function", () => {
  let last = "";
  const keep: (d: Dog) => void = (d: Dog, friend?: Dog) => {
    last += typeof friend + (friend === d ? " same " : " other ");
  };
  new Set(dogs).forEach(keep);
  return last;
});
show("dogs afterwards", () => dogs.map(d => d.legs));

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  tricks: string[] = ["sit"];
  bark(): string {
    return this.name + " barks";
  }
}

class Cat extends Animal {
  lives = 9;
}

class Keeper {
  fed: string[] = [];
  feed(a: Animal): string {
    this.fed.push(a.name);
    return "fed " + a.name;
  }
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function feedOf(k: Keeper, a: Animal): string {
  return k.feed(a);
}

function legsOf(d: Dog): string {
  return "legs " + typeof d.legs + " " + d.legs;
}

function doubleLegs(d: Dog): string {
  return "double " + d.legs * 2;
}

function trickOf(d: Dog): string {
  return "trick " + d.tricks[0];
}

function barkOf(d: Dog): string {
  return d.bark();
}

const replacements: [string, (d: Dog) => string][] = [
  ["reads a field", legsOf],
  ["computes with a field", doubleLegs],
  ["reads an element of a field", trickOf],
  ["calls a method", barkOf],
];

const animals: [string, () => Animal][] = [
  ["a dog", () => new Dog("rex")],
  ["a cat", () => new Cat("tom")],
  ["an animal", () => new Animal("any")],
];

const k = new Keeper();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += feedOf(k, new Dog("d")).length + legsOf(new Dog("d")).length + barkOf(new Dog("d")).length;
console.log("2000 honest: " + warm);

for (const [what, replacement] of replacements) {
  k.feed = replacement;
  for (const [who, make] of animals) attempt("own, " + what + ", " + who, () => feedOf(k, make()));
}
Reflect.deleteProperty(k, "feed");

const original = Keeper.prototype.feed;
for (const [what, replacement] of replacements) {
  Keeper.prototype.feed = replacement;
  for (const [who, make] of animals) attempt("on the prototype, " + what + ", " + who, () => feedOf(new Keeper(), make()));
}
Keeper.prototype.feed = original;
for (const [who, make] of animals) attempt("restored, " + who, () => feedOf(k, make()));
attempt("honest callers of the same functions", () => legsOf(new Dog("rex")) + " " + doubleLegs(new Dog("rex")) + " " + trickOf(new Dog("rex")) + " " + barkOf(new Dog("rex")));

export {};

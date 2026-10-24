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
  ownerOf(a: Animal): Person;
  speak(a: Animal): string;
  shoe(a: Animal, legs: number): void;
}

class DogKeeper implements Keeper {
  legsOf(d: Dog): number {
    return d.legs;
  }
  tagOf(d: Dog): string {
    return d.tag;
  }
  ownerOf(d: Dog): Person {
    return d.owner;
  }
  speak(d: Dog): string {
    return d.bark();
  }
  shoe(d: Dog, legs: number): void {
    d.legs = legs;
  }
}

const keeper: Keeper = new DogKeeper();

function legsAt(a: Animal): number {
  return keeper.legsOf(a);
}
function tagAt(a: Animal): string {
  return keeper.tagOf(a);
}
function ownerAt(a: Animal): Person {
  return keeper.ownerOf(a);
}
function speakAt(a: Animal): string {
  return keeper.speak(a);
}
function shoeAt(a: Animal, legs: number): void {
  keeper.shoe(a, legs);
}

const dogs: Dog[] = [];
for (let i = 0; i < 10; i++) dogs.push(new Dog("dog" + i));

let legs = 0;
let letters = 0;
let owners = 0;
let barks = 0;
for (let i = 0; i < 2000; i++) {
  const dog = dogs[i % 10];
  legs += legsAt(dog);
  letters += tagAt(dog).length;
  owners += ownerAt(dog).first.length;
  barks += speakAt(dog).length;
  shoeAt(dog, 4 + (i % 2));
}
show("2000 dogs: legs", () => legs);
show("2000 dogs: letters", () => letters);
show("2000 dogs: owners", () => owners);
show("2000 dogs: barks", () => barks);

const cat = new Cat("tom");
show("cat legs", () => legsAt(cat));
show("cat tag", () => tagAt(cat));
show("cat owner", () => ownerAt(cat));
show("cat speak", () => speakAt(cat));
show("cat shoe", () => shoeAt(cat, 9));
show("cat afterwards", () => cat);
show("cat legs after the store", () => legsAt(cat));
show("dog legs", () => legsAt(dogs[0]));
show("dog tag", () => tagAt(dogs[0]));
show("dog owner", () => ownerAt(dogs[0]));
show("dog speak", () => speakAt(dogs[0]));

const mixed: Animal[] = [];
for (let i = 0; i < 2000; i++) mixed.push(i === 1500 ? new Cat("hidden") : i === 1700 ? new Spider("hidden") : dogs[i % 10]);
let sum = 0;
let strange = "";
for (let i = 0; i < mixed.length; i++) {
  const n = legsAt(mixed[i]);
  if (typeof n === "number") sum += n;
  else strange += i + ":" + typeof n + ":" + n + " ";
}
show("a cat and a spider in the middle of the loop: sum", () => sum);
show("a cat and a spider in the middle of the loop: strange", () => strange);

let blind = 0;
for (let i = 0; i < mixed.length; i++) blind += legsAt(mixed[i]);
show("the same loop adding blindly", () => blind);

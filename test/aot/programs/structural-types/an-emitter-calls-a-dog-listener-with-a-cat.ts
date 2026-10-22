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

import { EventEmitter } from "node:events";

type Listener = { bivarianceHack(a: Animal): void }["bivarianceHack"];

class Emitter {
  listeners = new Map<string, Listener[]>();
  on(name: string, listener: Listener): this {
    const list = this.listeners.get(name);
    if (list === undefined) this.listeners.set(name, [listener]);
    else list.push(listener);
    return this;
  }
  emit(name: string, a: Animal): number {
    const list = this.listeners.get(name);
    if (list === undefined) return 0;
    for (const listener of list) listener(a);
    return list.length;
  }
}

const log: string[] = [];
let legsSeen = 0;
const tagsSeen: string[] = [];
const ownersSeen: Person[] = [];

function onLegs(d: Dog): void {
  legsSeen += d.legs;
  log.push("legs " + typeof d.legs + " " + d.legs);
}
function onTag(d: Dog): void {
  tagsSeen.push(d.tag);
  log.push("tag " + typeof d.tag + " " + d.tag);
}
function onOwner(d: Dog): void {
  ownersSeen.push(d.owner);
  log.push("owner " + typeof d.owner);
}
function onBark(d: Dog): void {
  log.push("bark " + d.bark());
}

const own = new Emitter();
own.on("pet", onLegs).on("pet", onTag).on("pet", onOwner).on("loud", onBark);

const node = new EventEmitter();
node.on("pet", onLegs);
node.on("pet", onTag);
node.on("pet", onOwner);
node.on("loud", onBark);

const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing"), new Dog("fido")];
for (const animal of animals) {
  const kind = animal.constructor.name;
  show("own pet " + kind, () => own.emit("pet", animal));
  show("own loud " + kind, () => own.emit("loud", animal));
  show("node pet " + kind, () => node.emit("pet", animal));
  show("node loud " + kind, () => node.emit("loud", animal));
}
show("node pet with a number", () => node.emit("pet", 5));
show("node pet with nothing", () => node.emit("pet"));
show("node loud with a string", () => node.emit("loud", "text"));

for (const entry of log) console.log(entry);
show("legs seen", () => legsSeen);
show("tags seen", () => tagsSeen.map(tag => typeof tag + " " + tag).join());
show("owners seen", () => ownersSeen.map(owner => typeof owner).join());
show("first owner", () => ownersSeen[0].first);
show("second owner", () => ownersSeen[1].first);

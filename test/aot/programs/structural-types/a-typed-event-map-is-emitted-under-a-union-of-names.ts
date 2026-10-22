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

interface Events {
  dog: Dog;
  cat: Cat;
  count: number;
  word: string;
}

type Handlers = { [K in keyof Events]: ((event: Events[K]) => void)[] };

class Bus {
  handlers: Handlers = { dog: [], cat: [], count: [], word: [] };
  on<K extends keyof Events>(name: K, handler: (event: Events[K]) => void): void {
    this.handlers[name].push(handler);
  }
  emit<K extends keyof Events>(name: K, event: Events[K]): number {
    const list = this.handlers[name];
    for (const handler of list) handler(event);
    return list.length;
  }
}

const log: string[] = [];
let legs = 0;
let counted = 0;
let letters = 0;
const bus = new Bus();
bus.on("dog", d => {
  legs += d.legs;
  log.push("dog handler: legs " + typeof d.legs + " " + d.legs + ", tag " + typeof d.tag);
});
bus.on("dog", d => {
  log.push("dog handler: " + d.bark());
});
bus.on("cat", c => {
  log.push("cat handler: lives " + typeof c.lives + " " + c.lives + ", weight " + (c.weight + 1));
});
bus.on("count", n => {
  counted += n;
  log.push("count handler: " + typeof n + " " + (n + 1));
});
bus.on("word", w => {
  letters += w.length;
  log.push("word handler: " + typeof w + " " + w.length);
});

function pick<T>(first: T, second: T, useFirst: boolean): T {
  return useFirst ? first : second;
}

show("honest dog", () => bus.emit("dog", new Dog("rex")));
show("honest cat", () => bus.emit("cat", new Cat("tom")));
show("honest count", () => bus.emit("count", 2));
show("honest word", () => bus.emit("word", "four"));

const petName: "dog" | "cat" = pick<"dog" | "cat">("dog", "cat", true);
show("a cat under 'dog'", () => bus.emit(petName, new Cat("sly")));
const otherPet: "dog" | "cat" = pick<"dog" | "cat">("dog", "cat", false);
show("a dog under 'cat'", () => bus.emit(otherPet, new Dog("lost")));
const scalar: "count" | "word" = pick<"count" | "word">("count", "word", true);
show("a string under 'count'", () => bus.emit(scalar, "text"));
const otherScalar: "count" | "word" = pick<"count" | "word">("count", "word", false);
show("a number under 'word'", () => bus.emit(otherScalar, 7));
const anyName: keyof Events = pick<keyof Events>("dog", "count", true);
show("a number under 'dog'", () => bus.emit(anyName, 7));

for (const entry of log) console.log(entry);
show("legs", () => legs);
show("counted", () => counted);
show("letters", () => letters);

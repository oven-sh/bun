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

interface Handler {
  handle(a: Animal): number;
}

const handlers = new Map<string, Handler>();
handlers.set("dog", {
  handle(d: Dog) {
    return d.legs * 100;
  },
});
handlers.set("cat", {
  handle(c: Cat) {
    return c.weight * 100;
  },
});
handlers.set("spider", {
  handle(s: Spider) {
    return s.tag * 100;
  },
});
handlers.set("owner", {
  handle(d: Dog) {
    return d.owner.first.length;
  },
});
handlers.set("tricks", {
  handle(d: Dog) {
    let letters = 0;
    for (const trick of d.tricks) letters += trick.length;
    return letters;
  },
});

const record: Record<string, Handler> = {};
for (const [name, handler] of handlers) record[name] = handler;

const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing")];

function dispatch(name: string, a: Animal): number {
  const handler = handlers.get(name);
  if (handler === undefined) return -1;
  return handler.handle(a);
}

for (const name of handlers.keys()) {
  for (const animal of animals) {
    show("map " + name + " gets " + animal.constructor.name, () => dispatch(name, animal));
    show("record " + name + " gets " + animal.constructor.name, () => record[name].handle(animal));
  }
}
show("no such handler", () => dispatch("fish", animals[0]));
show("no such entry", () => record["fish"].handle(animals[0]));

let total = 0;
for (let i = 0; i < 2000; i++) total += dispatch("dog", animals[0]);
show("2000 dogs for the dog handler", () => total);
show("a cat for the dog handler", () => dispatch("dog", animals[1]));
show("a spider for the dog handler", () => dispatch("dog", animals[2]));
show("a dog for the dog handler", () => dispatch("dog", animals[0]));

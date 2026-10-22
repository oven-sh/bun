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

class Counter {
  count: number = 10;
  label: string = "counter";
  items: number[] = [1, 2];
  read(): number {
    return this.count;
  }
  bump(): number {
    this.count += 1;
    return this.count;
  }
  title(): string {
    return this.label.toUpperCase();
  }
  size(): number {
    return this.items.length;
  }
  kind(): string {
    return typeof this;
  }
  add(n: number): number {
    return this.count + n;
  }
  arrow = (): number => this.count;
}

const counter = new Counter();
const read = counter.read;
const bump = counter.bump;
const title = counter.title;
const size = counter.size;
const kind = counter.kind;
const arrow = counter.arrow;
const { add } = counter;

show("honest read", () => counter.read());
show("bare read", () => read());
show("bare bump", () => bump());
show("bare title", () => title());
show("bare size", () => size());
show("bare kind", () => kind());
show("bare arrow", () => arrow());
show("destructured add", () => add(1));
show("parenthesized", () => (0, counter.read)());
show("conditional", () => (counter.count > 0 ? counter.read : counter.bump)());
show("map", () => [1, 2].map(counter.add));
show("map with this", () => [1, 2].map(counter.add, counter));
show("map with another this", () => [1, 2].map(counter.add, new Cat("tom")));
show("map with a look-alike", () => [1, 2].map(counter.add, { count: "text" }));
show("map with a number as this", () => [1, 2].map(counter.add, 5));
show("forEach", () => [1].forEach(counter.bump));
show("forEach with this", () => [1].forEach(counter.bump, counter));

const borrowed = { count: "many", read: counter.read, bump: counter.bump, kind: counter.kind };
show("on another object: read", () => borrowed.read());
show("on another object: bump", () => borrowed.bump());
show("on another object: count", () => borrowed.count);
show("on another object: kind", () => borrowed.kind());

show("call with a cat", () => counter.read.call(new Cat("tom")));
show("call with a look-alike", () => counter.read.call({ count: 3.5 }));
show("call with a string", () => counter.size.call("text"));
show("call with a number", () => counter.kind.call(5));
show("call with undefined", () => counter.read.call(undefined));
show("call with null", () => counter.kind.call(null));
show("apply with a cat", () => counter.title.apply(new Cat("tom")));
show("bind to a cat", () => counter.bump.bind(new Cat("tom"))());
show("bind to the counter", () => counter.bump.bind(counter)());
show("title of a look-alike", () => counter.title.call({ label: "small" }));
show("title of a wrong look-alike", () => counter.title.call({ label: 5 }));
show("size of a look-alike", () => counter.size.call({ items: "four" }));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += counter.read();
show("2000 honest reads", () => sum);
show("bare read again", () => read());
show("call with a cat again", () => counter.read.call(new Cat("tom")));
show("honest read again", () => counter.read());

Promise.resolve(1)
  .then(counter.add)
  .then(
    value => console.log("then: " + text(value)),
    error => console.log("then: threw " + error.constructor.name),
  );

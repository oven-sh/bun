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

class Shelf<T extends Animal> {
  items: T[] = [];
  last: T;
  constructor(first: T, private measure: { of(item: T): number }) {
    this.last = first;
  }
  add(item: T): number {
    this.items.push(item);
    this.last = item;
    return this.measure.of(item);
  }
  total(): number {
    let sum = 0;
    for (const item of this.items) sum += this.measure.of(item);
    return sum;
  }
  swap<U extends T>(item: U): U {
    this.last = item;
    return item;
  }
}

const dogShelf = new Shelf<Dog>(new Dog("first"), {
  of(d: Dog) {
    return d.legs;
  },
});
const anyShelf: Shelf<Animal> = dogShelf;

show("a dog is added", () => dogShelf.add(new Dog("rex")));
show("a cat is added through the wider type", () => anyShelf.add(new Cat("tom")));
show("a spider is added", () => anyShelf.add(new Spider("boris")));
show("total", () => dogShelf.total());
show("last legs", () => dogShelf.last.legs);
show("last tag", () => dogShelf.last.tag);
show("items: legs", () => dogShelf.items.map(d => typeof d.legs + " " + d.legs).join());
show("items: tag lengths", () => dogShelf.items.map(d => {
  try {
    return String(d.tag.length);
  } catch (error) {
    return "threw";
  }
}).join());
show("items: bark", () => dogShelf.items.map(d => {
  try {
    return d.bark();
  } catch (error) {
    return "threw";
  }
}).join());
show("swap", () => anyShelf.swap(new Cat("swapped")).lives);
show("last after swap: legs", () => dogShelf.last.legs);
show("last after swap: owner", () => dogShelf.last.owner);
show("last after swap: bark", () => dogShelf.last.bark());

interface Sink<T> {
  put(value: T): void;
}
class NumberSink implements Sink<number> {
  sum: number = 0;
  values: number[] = [];
  put(value: number): void {
    this.sum += value;
    this.values.push(value);
  }
}
const numberSink = new NumberSink();
const wideSink: Sink<number | string | undefined> = numberSink;
for (let i = 0; i < 2000; i++) numberSink.put(1);
show("2000 numbers", () => numberSink.sum);
wideSink.put("text");
show("after a string", () => numberSink.sum);
numberSink.sum = 1;
wideSink.put(undefined);
show("after undefined", () => numberSink.sum);
show("the last two values", () => numberSink.values.slice(-2).map(v => typeof v).join());
show("the last value plus one", () => numberSink.values[numberSink.values.length - 1] + 1);

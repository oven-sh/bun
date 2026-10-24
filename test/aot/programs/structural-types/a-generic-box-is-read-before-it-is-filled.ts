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

class Person {
  first: string = "ann";
}

class Box<T> {
  value!: T;
  filled: boolean = false;
  fill(value: T): this {
    this.value = value;
    this.filled = true;
    return this;
  }
  get(): T {
    return this.value;
  }
  getOr(fallback: T): T {
    return this.value ?? fallback;
  }
  map<U>(f: (value: T) => U): U {
    return f(this.value);
  }
}

class Late<T> {
  declare value: T;
  get(): T {
    return this.value;
  }
}

const numbers = new Box<number>();
show("number", () => numbers.get());
show("number + 1", () => numbers.get() + 1);
show("number or", () => numbers.getOr(5));
show("number mapped", () => numbers.map(n => n * 2));
show("number toFixed", () => numbers.map(n => n.toFixed(1)));
show("keys", () => Object.keys(numbers).join());
numbers.fill(4);
show("filled number + 1", () => numbers.get() + 1);
show("filled number mapped", () => numbers.map(n => n * 2));

const strings = new Box<string>();
show("string", () => strings.get());
show("string + '!'", () => strings.get() + "!");
show("string length", () => strings.map(s => s.length));
strings.fill("text");
show("filled string length", () => strings.map(s => s.length));

const people = new Box<Person>();
show("person", () => people.get());
show("person's name", () => people.map(p => p.first));
people.fill(new Person());
show("filled person's name", () => people.map(p => p.first));

const lists = new Box<number[]>();
show("list", () => lists.get());
show("list length", () => lists.map(l => l.length));
const functions = new Box<() => number>();
show("function", () => functions.get());
show("function called", () => functions.map(f => f()));

show("late number", () => new Late<number>().get());
show("late number + 1", () => new Late<number>().get() + 1);
show("late keys", () => Object.keys(new Late<number>()).length);

const boxes: Box<number>[] = [];
for (let i = 0; i < 2000; i++) boxes.push(new Box<number>().fill(1));
boxes.push(new Box<number>());
let sum = 0;
for (let i = 0; i < 2000; i++) sum += boxes[i].get();
show("2000 filled boxes", () => sum);
show("with the empty one", () => sum + boxes[2000].get());

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

const log: string[] = [];

function* kennel(): Generator<string, number, Dog> {
  let legs = 0;
  for (let i = 0; i < 4; i++) {
    const d = yield "ready " + i;
    log.push(i + " typeof " + typeof d);
    try {
      log.push(i + " legs " + typeof d.legs + " " + d.legs);
      legs += d.legs;
      log.push(i + " tag " + d.tag);
      log.push(i + " owner " + d.owner.first);
      log.push(i + " bark " + d.bark());
    } catch (error) {
      log.push(i + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
  }
  return legs;
}

function* adder(): Generator<number, string, number> {
  let sum = 0;
  let kinds = "";
  for (let i = 0; i < 4; i++) {
    const n = yield sum;
    kinds += typeof n + " ";
    sum += n;
  }
  return kinds + typeof sum + " " + sum;
}

const dogsOnly = kennel();
const anything: Generator<string, number, Animal> = dogsOnly;
show("start", () => anything.next(new Cat("ignored")));
show("a dog", () => dogsOnly.next(new Dog("rex")));
show("a cat", () => anything.next(new Cat("tom")));
show("a spider", () => anything.next(new Spider("boris")));
show("nothing", () => dogsOnly.next());
show("done", () => dogsOnly.next(new Dog("late")));
for (const entry of log) console.log(entry);

const numbers = adder();
const wide: Generator<number, string, number | string> = numbers;
show("adder start", () => numbers.next());
show("adder 1", () => numbers.next(1));
show("adder 'two'", () => wide.next("two"));
show("adder 3", () => numbers.next(3));
show("adder nothing", () => numbers.next());

const again = adder();
show("again start", () => again.next());
show("again 1", () => again.next(1));
show("again nothing", () => again.next());
show("again 2", () => again.next(2));
show("again 3", () => again.next(3));

show("for-of sends nothing", () => {
  const seen: number[] = [];
  const iterable: Iterable<number> = adder();
  for (const value of iterable) seen.push(value);
  return seen.map(v => String(v)).join();
});
show("spread sends nothing", () => {
  const iterable: Iterable<number> = adder();
  return [...iterable].map(v => String(v)).join();
});

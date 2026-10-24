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

interface Vet {
  check(a: Animal): string;
  weigh(a: Animal): number;
}

class DogVet implements Vet {
  seen: number = 0;
  check(d: Dog): string {
    this.seen++;
    return d.tag + "/" + d.legs + "/" + d.owner.first;
  }
  weigh(d: Dog): number {
    this.seen++;
    return d.legs * 2.5;
  }
}

const own = new DogVet();
const vet: Vet = own;

show("first call ever: a cat is checked", () => vet.check(new Cat("tom")));
show("first call ever: a cat is weighed", () => vet.weigh(new Cat("tom")));
show("a spider is checked", () => vet.check(new Spider("boris")));
show("a spider is weighed", () => vet.weigh(new Spider("boris")));
show("an animal is checked", () => vet.check(new Animal("thing")));
show("an animal is weighed", () => vet.weigh(new Animal("thing")));

const rex = new Dog("rex");
show("a typed caller checks a dog", () => own.check(rex));
show("a typed caller weighs a dog", () => own.weigh(rex));
let sum = 0;
for (let i = 0; i < 2000; i++) sum += own.weigh(rex);
show("2000 typed calls", () => sum);
show("a cat again", () => vet.weigh(new Cat("late")));
show("calls seen", () => own.seen);

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

interface Filler<T> {
  fill(make: () => T): void;
  each(visit: (item: T) => void): void;
}

class DogPen implements Filler<Dog> {
  dogs: Dog[] = [];
  legs: number = 0;
  fill(make: () => Dog): void {
    const d: Dog = make();
    this.legs += d.legs;
    this.dogs.push(d);
  }
  each(visit: (item: Dog) => void): void {
    for (const d of this.dogs) visit(d);
  }
}

const pen = new DogPen();
const wide: Filler<Animal> = pen;

pen.fill(() => new Dog("rex"));
show("legs after a dog", () => pen.legs);
wide.fill(() => new Cat("tom"));
show("legs after a cat", () => pen.legs);
pen.legs = 0;
wide.fill(() => new Spider("boris"));
show("legs after a spider", () => pen.legs);
wide.fill(() => ({ name: "literal" }));
show("how many", () => pen.dogs.length);

const seen: string[] = [];
pen.each(d => {
  seen.push(d.name + " " + typeof d.legs + " " + typeof d.tag + " " + typeof d.owner + " " + typeof d.bark);
});
for (const entry of seen) console.log(entry);

show("bark of each", () => {
  const out: string[] = [];
  pen.each(d => {
    try {
      out.push(d.bark());
    } catch (error) {
      out.push("threw");
    }
  });
  return out;
});
show("owner of each", () => {
  const out: string[] = [];
  pen.each(d => {
    try {
      out.push(d.owner.first);
    } catch (error) {
      out.push("threw");
    }
  });
  return out;
});

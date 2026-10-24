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

interface Trainer {
  train(a: Animal): Promise<string>;
  legsLater(a: Animal): Promise<number>;
  steps(a: Animal): Generator<string>;
  stream(a: Animal): AsyncGenerator<string>;
}

class DogTrainer implements Trainer {
  async train(d: Dog): Promise<string> {
    const before = d.tag;
    await null;
    return before + " " + d.bark();
  }
  async legsLater(d: Dog): Promise<number> {
    await null;
    const legs: number = d.legs;
    await null;
    return legs + 1;
  }
  *steps(d: Dog): Generator<string> {
    yield "legs " + typeof d.legs + " " + d.legs;
    yield "tag " + typeof d.tag + " " + d.tag;
    yield "owner " + d.owner.first;
    yield "never reached by an impostor";
  }
  async *stream(d: Dog): AsyncGenerator<string> {
    yield "legs " + (d.legs + 1);
    await null;
    yield "tricks " + d.tricks.length;
  }
}

const trainer: Trainer = new DogTrainer();

async function report(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    console.log(label + ": " + text(await run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

async function main(): Promise<void> {
  const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris"), new Animal("thing"), new Dog("fido")];
  for (const animal of animals) {
    const kind = animal.constructor.name;
    await report(kind + " train", () => trainer.train(animal));
    await report(kind + " legsLater", () => trainer.legsLater(animal));
    show(kind + " steps", () => {
      const seen: string[] = [];
      try {
        for (const step of trainer.steps(animal)) seen.push(step);
      } catch (error) {
        seen.push("threw");
      }
      return seen;
    });
    await report(kind + " stream", async () => {
      const seen: string[] = [];
      try {
        for await (const part of trainer.stream(animal)) seen.push(part);
      } catch (error) {
        seen.push("threw");
      }
      return seen;
    });
  }
  await report("all at once", () => Promise.allSettled(animals.map(a => trainer.legsLater(a))).then(results => results.map(r => (r.status === "fulfilled" ? String(r.value) : "rejected"))));
}

main().then(() => console.log("done"));

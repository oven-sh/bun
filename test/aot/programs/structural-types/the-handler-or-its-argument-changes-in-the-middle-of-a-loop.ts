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

class NameHandler implements Handler {
  handle(a: Animal): number {
    return a.name.length;
  }
}
class LegHandler implements Handler {
  handle(d: Dog): number {
    return d.legs;
  }
}

function tally(run: (i: number) => number, rounds: number): string {
  let sum = 0;
  let strange = 0;
  let thrown = 0;
  for (let i = 0; i < rounds; i++) {
    try {
      const n = run(i);
      if (typeof n === "number" && !Number.isNaN(n)) sum += n;
      else strange++;
    } catch (error) {
      thrown++;
    }
  }
  return "sum " + sum + ", strange " + strange + ", thrown " + thrown;
}

show("the argument changes", () => {
  const handler: Handler = new LegHandler();
  let animal: Animal = new Dog("rex");
  return tally(i => {
    if (i === 1000) animal = new Cat("tom");
    if (i === 1500) animal = new Dog("fido");
    return handler.handle(animal);
  }, 2000);
});

show("the handler changes", () => {
  let handler: Handler = new NameHandler();
  const animal: Animal = new Cat("tom");
  return tally(i => {
    if (i === 1000) handler = new LegHandler();
    if (i === 1500) handler = new NameHandler();
    return handler.handle(animal);
  }, 2000);
});

show("the field is deleted", () => {
  const handler: Handler = new LegHandler();
  const dog = new Dog("rex");
  const loose: { legs?: number } = dog;
  return tally(i => {
    if (i === 1000) delete loose.legs;
    if (i === 1500) dog.legs = 3;
    return handler.handle(dog);
  }, 2000);
});

show("the field becomes a getter", () => {
  const handler: Handler = new LegHandler();
  const dog = new Dog("rex");
  let reads = 0;
  const result = tally(i => {
    if (i === 1000) Object.defineProperty(dog, "legs", { get: () => (reads++, 10), configurable: true });
    return handler.handle(dog);
  }, 2000);
  return result + ", reads " + reads;
});

show("the field gets a string", () => {
  const handler: Handler = new LegHandler();
  const dog = new Dog("rex");
  const wide: { legs: number | string } = dog;
  return tally(i => {
    if (i === 1000) wide.legs = "four";
    if (i === 1500) wide.legs = 2.5;
    return handler.handle(dog);
  }, 2000);
});

show("the prototype of the argument changes", () => {
  const dog = new Dog("rex");
  return tally(i => {
    if (i === 1000) Object.setPrototypeOf(dog, Cat.prototype);
    if (i === 1500) Object.setPrototypeOf(dog, Dog.prototype);
    return dog.bark().length;
  }, 2000);
});

show("the method is replaced on the prototype", () => {
  const handler = new LegHandler();
  const dog = new Dog("rex");
  const original = LegHandler.prototype.handle;
  const result = tally(i => {
    if (i === 1000) LegHandler.prototype.handle = () => 100;
    if (i === 1500) LegHandler.prototype.handle = original;
    return handler.handle(dog);
  }, 2000);
  return result;
});

show("the callee itself swaps what it is given next", () => {
  const animals: Animal[] = [new Dog("rex")];
  let calls = 0;
  const handler: Handler = {
    handle(d: Dog) {
      calls++;
      if (calls === 1000) animals[0] = new Spider("boris");
      if (calls === 1010) animals[0] = new Dog("back");
      return d.legs;
    },
  };
  return tally(() => handler.handle(animals[0]), 2000);
});

show("the object is frozen", () => {
  const dog = new Dog("rex");
  const shoe: { put(a: Animal, n: number): void } = {
    put(d: Dog, n: number) {
      d.legs = n;
    },
  };
  const result = tally(i => {
    if (i === 1000) Object.freeze(dog);
    shoe.put(dog, i);
    return 1;
  }, 2000);
  return result + ", legs " + dog.legs;
});

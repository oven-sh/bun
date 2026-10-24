function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

class Cat {
  lives = 9;
  purr(): string {
    return "purr " + this.lives;
  }
}

class Meter {
  amount = 1;
  twice(): number {
    return this.amount * 2;
  }
}

class Foot {
  amount = 3;
  twice(): number {
    return this.amount * 20;
  }
}

class Eager {
  legs = 40;
  bark(): number {
    return -1;
  }
  static [Symbol.hasInstance](value: unknown): boolean {
    log.push("hasInstance");
    return true;
  }
}

function sound(pet: Dog | Cat): string {
  return pet instanceof Dog ? "bark " + pet.bark() : pet.purr();
}

function soundTheOtherWay(pet: Dog | Cat): string {
  if (pet instanceof Cat) return pet.purr();
  return "legs " + pet.legs;
}

function measure(m: Meter | Foot): string {
  if (m instanceof Meter) return "meter " + m.twice();
  return "foot " + m.twice();
}

function eager(pet: Eager | Cat): number {
  return pet instanceof Eager ? pet.legs + 1 : pet.lives;
}

attempt("honest", () => [sound(new Dog()), sound(new Cat()), soundTheOtherWay(new Dog()), soundTheOtherWay(new Cat()), measure(new Meter()), measure(new Foot())]);
let warm = 0;
const pets = [new Dog(), new Cat()];
for (let i = 0; i < 2000; i++) warm += sound(pets[i & 1]).length + soundTheOtherWay(pets[i & 1]).length + measure(i & 1 ? new Meter() : new Foot()).length;
console.log("2000 honest rounds", warm);

attempt("a literal for a dog", () => {
  const fake: Dog = { legs: 3, bark: () => 33 };
  return sound(fake);
});
attempt("a literal for a dog, the other way", () => {
  const fake: Dog = { legs: 3, bark: () => 33 };
  return soundTheOtherWay(fake);
});
attempt("a literal for a cat", () => {
  const fake: Cat = { lives: 1, purr: () => "fake purr" };
  return [sound(fake), soundTheOtherWay(fake)];
});
attempt("a foot typed as a meter", () => {
  const m: Meter = new Foot();
  return measure(m);
});
attempt("a literal typed as a meter", () => {
  const m: Meter = { amount: 7, twice: () => 70 };
  return measure(m);
});
attempt("a cat whose prototype became a dog's", () => {
  const cat = new Cat();
  Object.setPrototypeOf(cat, Dog.prototype);
  return sound(cat);
});
attempt("a dog whose prototype was removed", () => {
  const dog = new Dog();
  Object.setPrototypeOf(dog, null);
  return sound(dog);
});
attempt("a dog whose prototype became a cat's", () => {
  const dog = new Dog();
  Object.setPrototypeOf(dog, Cat.prototype);
  return [sound(dog), soundTheOtherWay(dog)];
});
attempt("a class that says yes to everything", () => eager(new Cat()));
attempt("a class that says yes to everything, honest", () => eager(new Eager()));
attempt("the prototype changes after the test", () => {
  const pet: Dog | Cat = pets[0];
  const copy = new Dog();
  const check = (p: Dog | Cat): number | string => {
    if (p instanceof Dog) {
      Object.setPrototypeOf(p, Cat.prototype);
      return p.bark();
    }
    return p.purr();
  };
  return [check(copy), sound(pet)];
});
attempt("a subclass that overrides", () => {
  class Puppy extends Dog {
    bark(): number {
      return 1;
    }
  }
  return sound(new Puppy());
});
attempt("a proxy of a dog", () => sound(new Proxy(new Dog(), { getPrototypeOf: () => (log.push("getPrototypeOf"), Cat.prototype) })));
attempt("a bound class on the right", () => {
  const Bound = Dog.bind(null);
  const pet: Dog | Cat = new Dog();
  return pet instanceof Bound;
});
attempt("in elements", () => {
  const fake: Dog = { legs: 3, bark: () => 33 };
  const list: (Dog | Cat)[] = [new Dog(), new Cat(), fake];
  const results: string[] = [];
  for (const pet of list) {
    try {
      results.push(sound(pet));
    } catch (error) {
      results.push(error instanceof Error ? error.constructor.name : "other");
    }
  }
  return results;
});
attempt("honest again", () => [sound(new Dog()), sound(new Cat()), soundTheOtherWay(new Dog()), measure(new Meter()), measure(new Foot())]);

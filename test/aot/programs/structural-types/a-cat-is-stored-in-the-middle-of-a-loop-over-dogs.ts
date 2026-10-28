function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  tag = "dog tag";
  owner = { id: 7 };
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives = "nine";
  indoor = true;
  purr(): string {
    return this.name + " purrs";
  }
}

function kennel(size: number): Dog[] {
  const dogs: Dog[] = [];
  for (let i = 0; i < size; i++) dogs.push(new Dog("d" + i));
  return dogs;
}

function count(value: number): number {
  return value === value ? value : 1000000;
}

function byIndex(dogs: Dog[], animals: Animal[], at: number): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) {
    if (i === at) animals[at + 1] = new Cat("tom");
    total += count(dogs[i].legs);
  }
  return total;
}

function byForOf(dogs: Dog[], animals: Animal[], at: number): number {
  let total = 0;
  let i = 0;
  for (const dog of dogs) {
    if (i++ === at) animals[at + 1] = new Cat("tom");
    total += count(dog.legs);
  }
  return total;
}

function byForEach(dogs: Dog[], animals: Animal[], at: number): number {
  let total = 0;
  dogs.forEach((dog, i) => {
    if (i === at) animals[at + 1] = new Cat("tom");
    total += count(dog.legs);
  });
  return total;
}

function sameElementTwice(dogs: Dog[], animals: Animal[]): unknown[] {
  const before = dogs[0].legs;
  animals[0] = new Cat("tom");
  const after = dogs[0].legs;
  return [before, after];
}

function heldInALocal(dogs: Dog[], animals: Animal[]): unknown[] {
  const dog = dogs[0];
  animals[0] = new Cat("tom");
  return [dog.legs, dogs[0].legs, dog === dogs[0]];
}

function inACallee(dogs: Dog[], change: () => void): unknown[] {
  const before = dogs[0].legs;
  change();
  return [before, dogs[0].legs, dogs[0].tag];
}

function barksUntilItThrows(dogs: Dog[], animals: Animal[], at: number): string {
  let barked = 0;
  try {
    for (let i = 0; i < dogs.length; i++) {
      if (i === at) animals[at + 1] = new Cat("tom");
      barked += dogs[i].bark().length > 0 ? 1 : 0;
    }
  } catch (error) {
    return "threw after " + barked + " " + (error instanceof Error ? error.constructor.name : "");
  }
  return "barked " + barked;
}

attempt("honest: by index", () => {
  const dogs = kennel(4000);
  return byIndex(dogs, [], -5);
});
for (const at of [0, 1500, 3998]) {
  attempt("at " + at + ": by index", () => {
    const dogs = kennel(4000);
    return byIndex(dogs, dogs, at);
  });
  attempt("at " + at + ": by for-of", () => {
    const dogs = kennel(4000);
    return byForOf(dogs, dogs, at);
  });
  attempt("at " + at + ": by forEach", () => {
    const dogs = kennel(4000);
    return byForEach(dogs, dogs, at);
  });
  attempt("at " + at + ": barks", () => {
    const dogs = kennel(4000);
    return barksUntilItThrows(dogs, dogs, at);
  });
}
attempt("the same element twice", () => {
  const dogs = kennel(2);
  return sameElementTwice(dogs, dogs);
});
attempt("held in a local", () => {
  const dogs = kennel(2);
  return heldInALocal(dogs, dogs);
});
attempt("changed in a callee", () => {
  const dogs = kennel(2);
  const animals: Animal[] = dogs;
  return inACallee(dogs, () => void (animals[0] = new Cat("tom")));
});
attempt("changed by a getter of another object", () => {
  const dogs = kennel(2);
  const animals: Animal[] = dogs;
  const trap = {
    get step(): number {
      animals[1] = new Cat("tom");
      return 1;
    },
  };
  return dogs[0].legs + trap.step + dogs[1].legs;
});
attempt("changed while an argument list is evaluated", () => {
  const dogs = kennel(2);
  const animals: Animal[] = dogs;
  const three = (a: number, b: number, c: number) => [a, b, c];
  return three(dogs[0].legs, animals.unshift(new Cat("tom")), dogs[0].legs);
});
attempt("a cat comes and goes", () => {
  const dogs = kennel(3);
  const animals: Animal[] = dogs;
  const seen: unknown[] = [];
  for (let round = 0; round < 6; round++) {
    animals[1] = round % 2 === 0 ? new Cat("tom") : new Dog("back");
    seen.push(dogs[1].legs);
  }
  return seen;
});

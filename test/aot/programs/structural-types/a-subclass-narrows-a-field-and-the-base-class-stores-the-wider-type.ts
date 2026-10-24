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

class Home {
  pet: Animal = new Animal("any");
  adopt(animal: Animal): void {
    this.pet = animal;
  }
  reset(): void {
    this.pet = new Cat("stray");
  }
}

class DogHome extends Home {
  pet: Dog = new Dog("rex");
  legs(): number {
    return this.pet.legs + 1;
  }
  bark(): string {
    return this.pet.bark();
  }
}

class Counter {
  value: number | string = 0;
  label(text: string): void {
    this.value = text;
  }
}

class NumberCounter extends Counter {
  value: number = 1;
  doubled(): number {
    return this.value * 2;
  }
  next(): number {
    return this.value + 1;
  }
}

class Pack {
  members: Animal[] = [];
  add(animal: Animal): void {
    this.members.push(animal);
  }
}

class DogPack extends Pack {
  members: Dog[] = [new Dog("rex")];
  totalLegs(): number {
    let total = 0;
    for (const dog of this.members) total += dog.legs;
    return total;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const home = new DogHome();
  home.adopt(new Dog("d"));
  const counter = new NumberCounter();
  const pack = new DogPack();
  pack.add(new Dog("e"));
  warm += home.legs() + home.bark().length + counter.doubled() + counter.next() + pack.totalLegs();
}
console.log("after 2000 honest uses", warm);

attempt("the base method adopts a cat", () => {
  const home = new DogHome();
  home.adopt(new Cat("tom"));
  return [home.legs(), home.pet.name, home.pet.tag, home.pet instanceof Dog];
});
attempt("the base method adopts a cat, which barks", () => {
  const home = new DogHome();
  home.adopt(new Cat("tom"));
  return home.bark();
});
attempt("the base method resets", () => {
  const home = new DogHome();
  home.reset();
  return [home.legs(), home.pet.name];
});
attempt("a dog again", () => {
  const home = new DogHome();
  home.reset();
  home.adopt(new Dog("back"));
  return [home.legs(), home.bark()];
});
attempt("the base method stores a string into a number", () => {
  const counter = new NumberCounter();
  counter.label("five");
  return [counter.doubled(), counter.next(), typeof counter.value];
});
attempt("the base method stores the text 5", () => {
  const counter = new NumberCounter();
  counter.label("5");
  return [counter.doubled(), counter.next()];
});
attempt("the base method pushes a cat", () => {
  const pack = new DogPack();
  pack.add(new Cat("tom"));
  return [pack.totalLegs(), pack.members.map(dog => dog.legs)];
});
attempt("through a variable of the base type", () => {
  const home = new DogHome();
  const base: Home = home;
  base.pet = new Cat("tom");
  return [home.legs(), home.pet.name];
});
attempt("homes of both classes in one array", () => {
  const homes: Home[] = [new Home(), new DogHome(), new DogHome()];
  homes.forEach((home, index) => index === 1 && home.reset());
  return homes.map(home => (home instanceof DogHome ? home.legs() : home.pet.name));
});

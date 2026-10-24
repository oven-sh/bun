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

function pollute(dogs: Dog[]): Dog[] {
  const animals: Animal[] = dogs;
  animals.push(new Cat("tom"));
  return dogs;
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}

function made(): Dog[] {
  return pollute([new Dog("rex")]);
}

function reader(dogs: Dog[]): () => number {
  return () => dogs[dogs.length - 1].legs + 1;
}

function oneOrMany(value: Dog[] | Dog): number {
  return Array.isArray(value) ? totalLegs(value) : value.legs;
}

function manyOrNone(value: Dog[] | null): number {
  return value === null ? -1 : totalLegs(value);
}

function generic<T extends Dog[]>(dogs: T): number {
  return dogs[1].legs + 1;
}

let shared: Dog[] = [new Dog("rex")];
function lastShared(): number {
  return shared[shared.length - 1].legs + 1;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [new Dog("a"), new Dog("b")];
  warm += totalLegs(honest) + reader(honest)() + oneOrMany(honest) + oneOrMany(honest[0]) + manyOrNone(honest) + manyOrNone(null) + generic(honest) + lastShared();
}
console.log("after 2000 honest arrays", warm);

attempt("a parameter", () => totalLegs(pollute([new Dog("rex")])));
attempt("a local", () => {
  const local: Dog[] = [new Dog("rex")];
  pollute(local);
  return [local[1].legs, local[1].tag, local[1].name];
});
attempt("a local, called", () => {
  const local: Dog[] = [new Dog("rex")];
  pollute(local);
  return local[1].bark();
});
attempt("a result", () => [totalLegs(made()), made()[1].legs, made()[1].name]);
attempt("a captured variable", () => {
  const dogs = [new Dog("rex")];
  const read = reader(dogs);
  const before = read();
  pollute(dogs);
  return [before, read()];
});
attempt("a module variable", () => {
  const before = lastShared();
  pollute(shared);
  const after = lastShared();
  shared = [new Dog("rex")];
  return [before, after, lastShared()];
});
attempt("a member of a union with one dog", () => [oneOrMany(made()), oneOrMany(made()[1]), oneOrMany(made()[0])]);
attempt("a member of a union with null", () => manyOrNone(made()));
attempt("a generic", () => generic(made()));
attempt("a member of a literal", () => {
  const holder = { before: 1, dogs: [new Dog("rex")], after: 2 };
  pollute(holder.dogs);
  return [holder.before, totalLegs(holder.dogs), holder.after];
});
attempt("a private field", () => {
  class Kennel {
    #dogs: Dog[] = [new Dog("rex")];
    get dogs(): Dog[] {
      return this.#dogs;
    }
    total(): number {
      return totalLegs(this.#dogs);
    }
  }
  const kennel = new Kennel();
  pollute(kennel.dogs);
  return kennel.total();
});
attempt("a static field", () => {
  class Registry {
    static dogs: Dog[] = [new Dog("rex")];
  }
  pollute(Registry.dogs);
  return Registry.dogs.map(dog => dog.legs);
});
attempt("a default parameter", () => {
  const stock = made();
  const count = (dogs: Dog[] = stock) => totalLegs(dogs);
  return [count(), count([new Dog("a")])];
});
attempt("honest again", () => [totalLegs([new Dog("a")]), generic([new Dog("a"), new Dog("b")])]);

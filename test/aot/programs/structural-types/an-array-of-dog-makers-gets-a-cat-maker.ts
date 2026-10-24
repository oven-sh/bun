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

type Maker<T> = () => T;

function legsOfMade(makers: Maker<Dog>[], index: number): number {
  return makers[index]().legs + 1;
}

function barkOfMade(makers: Maker<Dog>[], index: number): string {
  return makers[index]().bark();
}

function makeAll(makers: Maker<Dog>[]): Dog[] {
  const made: Dog[] = [];
  for (const make of makers) made.push(make());
  return made;
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (const dog of dogs) total += dog.legs;
  return total;
}

class Breeder {
  make: Maker<Dog> = () => new Dog("bred");
  legs(): number {
    return this.make().legs + 1;
  }
}

interface Factory<T> {
  create(): T;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Maker<Dog>[] = [() => new Dog("a"), () => new Dog("b")];
  warm += legsOfMade(honest, 1) + barkOfMade(honest, 0).length + totalLegs(makeAll(honest)) + new Breeder().legs();
}
console.log("after 2000 honest makers", warm);

const makers: Maker<Dog>[] = [() => new Dog("rex")];
const wide: Maker<Animal>[] = makers;
wide.push(() => new Cat("tom"));
wide.push(() => ({ name: "only a name" }));
makers.push(() => new Dog("fido"));

for (let index = 0; index < makers.length; index++) {
  attempt(index + ": legs + 1", () => legsOfMade(makers, index));
  attempt(index + ": bark", () => barkOfMade(makers, index));
  attempt(index + ": tag", () => makers[index]().tag);
}
attempt("all made: legs", () => makeAll(makers).map(dog => dog.legs));
attempt("all made: total", () => totalLegs(makeAll(makers)));
attempt("a field that holds a maker", () => {
  const breeder = new Breeder();
  const loose: { make: Maker<Animal> } = breeder;
  const before = breeder.legs();
  loose.make = () => new Cat("tom");
  return [before, breeder.legs(), breeder.make().name];
});
attempt("a factory", () => {
  const factories: Factory<Dog>[] = [{ create: () => new Dog("rex") }];
  const loose: Factory<Animal>[] = factories;
  loose.push({ create: () => new Cat("tom") });
  return factories.map(factory => factory.create().legs);
});
attempt("makers of numbers get a maker of strings", () => {
  const counters: Maker<number>[] = [() => 1];
  const loose: Maker<number | string>[] = counters;
  loose.push(() => "2");
  let total = 0;
  for (const counter of counters) total += counter();
  return [total, counters[1]() * 2];
});
attempt("makers of arrays of dogs", () => {
  const packs: Maker<Dog[]>[] = [() => [new Dog("rex")]];
  const loose: Maker<Animal[]>[] = packs;
  loose.push(() => [new Cat("tom")]);
  return packs.map(pack => totalLegs(pack()));
});
attempt("a getter that makes a dog", () => {
  const sources: { readonly pet: Dog }[] = [{ pet: new Dog("rex") }];
  const loose: { readonly pet: Animal }[] = sources;
  loose.push({
    get pet() {
      return new Cat("tom");
    },
  });
  return sources.map(source => source.pet.legs);
});

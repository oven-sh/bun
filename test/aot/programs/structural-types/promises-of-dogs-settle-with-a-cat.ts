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

async function legsLater(dog: Promise<Dog>): Promise<number> {
  return (await dog).legs + 1;
}

async function barkLater(dog: Promise<Dog>): Promise<string> {
  try {
    return (await dog).bark();
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

async function totalLater(dogs: Promise<Dog[]>): Promise<number> {
  let total = 0;
  for (const dog of await dogs) total += dog.legs;
  return total;
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  warm += (await legsLater(Promise.resolve(new Dog("a")))) + (await barkLater(Promise.resolve(new Dog("b")))).length + (await totalLater(Promise.resolve([new Dog("c")])));
}
console.log("after 500 honest promises", warm);

const kennel: { next: Promise<Dog> } = { next: Promise.resolve(new Dog("rex")) };
const shelter: { next: Promise<Animal> } = kennel;
console.log("before: legs + 1 ->", show(await legsLater(kennel.next)));
shelter.next = Promise.resolve(new Cat("tom"));
console.log("after: legs + 1 ->", show(await legsLater(kennel.next)));
console.log("after: bark ->", show(await barkLater(kennel.next)));
console.log("after: then ->", show(await kennel.next.then(dog => [dog.name, dog.legs, dog.tag])));

const pack: Dog[] = [new Dog("rex")];
const promisedDogs: Promise<Dog[]> = Promise.resolve(pack);
const promisedAnimals: Promise<Animal[]> = promisedDogs;
(await promisedAnimals).push(new Cat("tom"));
console.log("an array inside a promise ->", show(await totalLater(promisedDogs)));
console.log("the same array ->", show((await promisedDogs) === pack));

const waiting: Promise<Dog>[] = [Promise.resolve(new Dog("a"))];
const waitingAnimals: Promise<Animal>[] = waiting;
waitingAnimals.push(Promise.resolve(new Cat("b")));
console.log("Promise.all ->", show((await Promise.all(waiting)).map(dog => dog.legs)));
console.log("Promise.race ->", show((await Promise.race(waiting.slice(1))).legs));
console.log("Promise.allSettled ->", show((await Promise.allSettled(waiting)).map(result => (result.status === "fulfilled" ? result.value.legs : "rejected"))));

const resolvers: ((dog: Dog) => void)[] = [];
const made = new Promise<Dog>(resolve => resolvers.push(resolve));
const looser: ((cat: never) => void)[] = resolvers;
console.log("resolvers ->", show(looser.length));
resolvers[0](new Dog("late"));
console.log("resolved late ->", show(await legsLater(made)));

async function* litter(animals: Animal[]): AsyncGenerator<Animal> {
  for (const animal of animals) yield animal;
}
const sources: { puppies: AsyncGenerator<Dog> | AsyncGenerator<Animal> } = { puppies: litter([new Dog("p"), new Cat("q")]) };
let names = "";
for await (const animal of sources.puppies) names += animal.name;
console.log("an async generator ->", show(names));

export {};

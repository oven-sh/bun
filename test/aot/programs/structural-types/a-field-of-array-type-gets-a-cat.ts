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

class Kennel {
  label = "kennel";
  dogs: Dog[] = [];
  capacity = 2;
  totalLegs(): number {
    let total = 0;
    for (const dog of this.dogs) total += dog.legs;
    return total;
  }
  firstBark(): string {
    return this.dogs[0].bark();
  }
  lastTag(): string {
    return this.dogs[this.dogs.length - 1].tag;
  }
}

interface Shelter {
  dogs: Animal[];
}

function admit(shelter: Shelter, animal: Animal): void {
  shelter.dogs.push(animal);
}

function replaceAll(shelter: Shelter, animals: Animal[]): void {
  shelter.dogs = animals;
}

function concatenate(shelter: Shelter, animal: Animal): void {
  shelter.dogs = shelter.dogs.concat([animal]);
}

function full(): Kennel {
  const kennel = new Kennel();
  kennel.dogs.push(new Dog("rex"), new Dog("fido"));
  return kennel;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = full();
  warm += honest.totalLegs() + honest.firstBark().length + honest.lastTag().length;
}
console.log("after 2000 honest kennels", warm);

function report(name: string, kennel: Kennel): void {
  attempt(name + ": total legs", () => kennel.totalLegs());
  attempt(name + ": first bark", () => kennel.firstBark());
  attempt(name + ": last tag", () => kennel.lastTag());
  attempt(name + ": legs", () => kennel.dogs.map(dog => dog.legs));
  attempt(name + ": the other fields", () => [kennel.label, kennel.capacity]);
}

{
  const kennel = full();
  admit(kennel, new Cat("tom"));
  report("a cat is pushed", kennel);
}
{
  const kennel = full();
  replaceAll(kennel, [new Cat("tom"), new Cat("kit")]);
  report("the array is replaced", kennel);
}
{
  const kennel = full();
  concatenate(kennel, new Cat("tom"));
  report("the array is replaced by a concatenation", kennel);
}
{
  const kennel = full();
  const before = kennel.dogs;
  let animals: Animal[] = kennel.dogs;
  animals = animals.concat([new Cat("tom")]);
  report("only a local is replaced by a concatenation", kennel);
  console.log("the local", animals.length, before === kennel.dogs);
}
{
  const kennel = full();
  const shelter: Shelter = kennel;
  shelter.dogs.unshift(new Cat("tom"));
  report("a cat is unshifted", kennel);
}
{
  const kennel = full();
  const { dogs }: Shelter = kennel;
  dogs[1] = new Cat("tom");
  report("through a destructured field", kennel);
}
{
  const literal: { dogs: Dog[]; count: number } = { dogs: [new Dog("rex")], count: 1 };
  admit(literal, new Cat("tom"));
  attempt("a literal with a field of dogs", () => [literal.dogs.map(dog => dog.legs + 1), literal.count]);
}
{
  const kennels: Kennel[] = [full(), full()];
  const shelters: Shelter[] = kennels;
  shelters[1].dogs.push(new Cat("tom"));
  shelters.push({ dogs: [new Cat("kit")] });
  attempt("an array of kennels: legs", () => kennels.map(kennel => kennel.dogs.map(dog => dog.legs)));
  attempt("an array of kennels: methods", () => kennels.map(kennel => kennel.totalLegs()));
}
report("an honest kennel again", full());

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

async function totalLegs(dogs: Dog[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) {
    await null;
    total += dogs[i].legs;
  }
  return total;
}

async function legsBeforeAndAfter(dogs: Dog[], between: () => void): Promise<unknown[]> {
  const before = dogs[0].legs;
  await null;
  between();
  await null;
  return [before, dogs[0].legs, dogs[0].name];
}

async function heldAcrossAnAwait(dogs: Dog[], between: () => void): Promise<unknown[]> {
  const dog = dogs[0];
  await Promise.resolve().then(between);
  return [dog.legs, dogs[0].legs];
}

function* eachLegs(dogs: Dog[]): Generator<number> {
  for (const dog of dogs) yield dog.legs;
}

function* eachDog(dogs: Dog[]): Generator<Dog, void, Animal | undefined> {
  const animals: Animal[] = dogs;
  for (let i = 0; i < dogs.length; i++) {
    const replacement = yield dogs[i];
    if (replacement !== undefined && i + 1 < dogs.length) animals[i + 1] = replacement;
  }
}

function kennel(): Dog[] {
  return [new Dog("rex"), new Dog("fido"), new Dog("spot")];
}

let warm = 0;
for (let i = 0; i < 300; i++) {
  warm += (await totalLegs(kennel())) + (await legsBeforeAndAfter(kennel(), () => {})).length + [...eachLegs(kennel())].length;
}
console.log("after 300 honest kennels", warm);

{
  const dogs = kennel();
  const animals: Animal[] = dogs;
  animals[1] = new Cat("tom");
  console.log("polluted before the call ->", show(await totalLegs(dogs)));
}
{
  const dogs = kennel();
  const animals: Animal[] = dogs;
  const pending = totalLegs(dogs);
  animals[2] = new Cat("tom");
  console.log("polluted while the function is suspended ->", show(await pending));
}
{
  const dogs = kennel();
  const animals: Animal[] = dogs;
  console.log("polluted between two awaits ->", show(await legsBeforeAndAfter(dogs, () => void (animals[0] = new Cat("tom")))));
}
{
  const dogs = kennel();
  const animals: Animal[] = dogs;
  console.log("an element held across an await ->", show(await heldAcrossAnAwait(dogs, () => void (animals[0] = new Cat("tom")))));
}
attempt("polluted between two yields", () => {
  const dogs = kennel();
  const animals: Animal[] = dogs;
  const seen: unknown[] = [];
  for (const legs of eachLegs(dogs)) {
    seen.push(legs);
    animals[2] = new Cat("tom");
  }
  return seen;
});
attempt("a cat is sent into the generator", () => {
  const generator = eachDog(kennel());
  const seen: unknown[] = [];
  let step = generator.next();
  while (!step.done) {
    seen.push(step.value.name, step.value.legs);
    step = generator.next(seen.length === 2 ? new Cat("tom") : undefined);
  }
  return seen;
});
{
  const dogs = kennel();
  const animals: Animal[] = dogs;
  animals.push(new Cat("tom"));
  console.log("mapped to promises ->", show(await Promise.all(dogs.map(async dog => dog.legs + 1))));
}

export {};

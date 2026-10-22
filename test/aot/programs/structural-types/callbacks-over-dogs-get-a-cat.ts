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

function byLegs(a: Dog, b: Dog): number {
  return a.legs - b.legs;
}

function legsOf(dog: Dog): number {
  return dog.legs;
}

function legsTimesTwo(dog: Dog): number {
  return dog.legs * 2;
}

function hasFourLegs(dog: Dog): boolean {
  return dog.legs === 4;
}

function addLegs(total: number, dog: Dog): number {
  return total + dog.legs;
}

function tagOf(dog: Dog): string {
  return dog.tag.toUpperCase();
}

function barkOf(dog: Dog): string {
  return dog.bark();
}

function kennel(): Dog[] {
  const dogs = [new Dog("rex"), new Dog("fido"), new Dog("spot")];
  dogs[0].legs = 3;
  return dogs;
}

function polluted(): Dog[] {
  const dogs = kennel();
  const animals: Animal[] = dogs;
  animals[1] = new Cat("tom");
  return dogs;
}

let warm = 0;
for (let i = 0; i < 1000; i++) {
  const dogs = kennel();
  warm += dogs.sort(byLegs)[0].legs + dogs.map(legsOf)[0] + dogs.map(legsTimesTwo)[1] + dogs.filter(hasFourLegs).length + dogs.reduce(addLegs, 0);
  warm += dogs.map(tagOf).length + dogs.map(barkOf).length;
}
console.log("after 1000 honest kennels", warm);

for (const [name, make] of [["honest", kennel], ["polluted", polluted]] satisfies [string, () => Dog[]][]) {
  attempt(name + ": sort", () => make().sort(byLegs).map(dog => dog.name));
  attempt(name + ": toSorted", () => make().toSorted(byLegs).map(dog => dog.name));
  attempt(name + ": map legs", () => make().map(legsOf));
  attempt(name + ": map legs * 2", () => make().map(legsTimesTwo));
  attempt(name + ": filter", () => make().filter(hasFourLegs).map(dog => dog.name));
  attempt(name + ": reduce", () => make().reduce(addLegs, 0));
  attempt(name + ": reduceRight", () => make().reduceRight(addLegs, 0));
  attempt(name + ": find", () => make().find(dog => dog.legs !== 3 && dog.legs !== 4)?.name);
  attempt(name + ": findIndex", () => make().findIndex(dog => !hasFourLegs(dog) && dog.legs !== 3));
  attempt(name + ": every", () => make().every(dog => dog.legs > 0));
  attempt(name + ": some", () => make().some(dog => dog.legs === undefined));
  attempt(name + ": map tags", () => make().map(tagOf));
  attempt(name + ": map barks", () => make().map(barkOf));
  attempt(name + ": forEach", () => {
    let total = 0;
    make().forEach(dog => {
      total += dog.legs;
    });
    return total;
  });
  attempt(name + ": flatMap", () => make().flatMap(dog => [dog.legs, dog.tag]));
  attempt(name + ": Array.from", () => Array.from(make(), legsTimesTwo));
  attempt(name + ": entries", () => {
    const seen: unknown[] = [];
    for (const [index, dog] of make().entries()) seen.push(index, dog.legs);
    return seen;
  });
  attempt(name + ": Math.max over legs", () => Math.max(...make().map(legsOf)));
  attempt(name + ": grouped by legs", () => Object.keys(Object.groupBy(make(), dog => String(dog.legs))));
}

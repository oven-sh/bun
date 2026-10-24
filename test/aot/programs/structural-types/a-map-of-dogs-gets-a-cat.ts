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

function legsOf(dogs: Map<string, Dog>, name: string): number {
  const dog = dogs.get(name);
  return dog === undefined ? -1 : dog.legs + 1;
}

function barkOf(dogs: Map<string, Dog>, name: string): string {
  return dogs.get(name)?.bark() ?? "nobody";
}

function totalLegs(dogs: Map<string, Dog>): number {
  let total = 0;
  for (const dog of dogs.values()) total += dog.legs;
  return total;
}

function totalByEntries(dogs: Map<string, Dog>): string {
  let text = "";
  for (const [name, dog] of dogs) text += name + "=" + dog.legs + ";";
  return text;
}

function totalByForEach(dogs: Map<string, Dog>): number {
  let total = 0;
  dogs.forEach(dog => {
    total += dog.legs;
  });
  return total;
}

function add(animals: Map<string, Animal>, animal: Animal): void {
  animals.set(animal.name, animal);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Map([["a", new Dog("a")], ["b", new Dog("b")]]);
  warm += legsOf(honest, "a") + barkOf(honest, "b").length + totalLegs(honest) + totalByEntries(honest).length + totalByForEach(honest);
}
console.log("after 2000 honest maps", warm);

const dogs = new Map<string, Dog>([["rex", new Dog("rex")]]);
const animals: Map<string, Animal> = dogs;
animals.set("tom", new Cat("tom"));
add(dogs, new Cat("kit"));
dogs.set("fido", new Dog("fido"));

for (const name of ["rex", "tom", "kit", "fido", "nobody"]) {
  attempt(name + ": legs + 1", () => legsOf(dogs, name));
  attempt(name + ": bark", () => barkOf(dogs, name));
}
attempt("total legs", () => totalLegs(dogs));
attempt("by entries", () => totalByEntries(dogs));
attempt("by forEach", () => totalByForEach(dogs));
attempt("values spread", () => [...dogs.values()].map(dog => dog.legs));
attempt("an old dog replaced by a cat", () => {
  animals.set("rex", new Cat("rex"));
  return [legsOf(dogs, "rex"), dogs.get("rex")?.tag, dogs.size];
});

attempt("dogs as keys", () => {
  const ages = new Map<Dog, number>([[new Dog("rex"), 3]]);
  const wide: Map<Animal, number> = ages;
  wide.set(new Cat("tom"), 5);
  let total = 0;
  for (const [dog, age] of ages) total += dog.legs * age;
  return [total, [...ages.keys()].map(dog => typeof dog.legs)];
});
attempt("numbers as values get a string", () => {
  const counts = new Map<string, number>([["a", 1]]);
  const wide: Map<string, number | string> = counts;
  wide.set("b", "two");
  let total = 0;
  for (const count of counts.values()) total += count;
  return [total, (counts.get("b") ?? 0) * 2, typeof counts.get("b")];
});
attempt("a readonly map changes under its reader", () => {
  const counts = new Map<string, number>([["a", 1]]);
  const view: ReadonlyMap<string, number> = counts;
  const before = [view.size, view.get("a")];
  counts.set("a", 2).set("b", 3);
  return [...before, view.size, view.get("a")];
});
attempt("a map of arrays of dogs", () => {
  const packs = new Map<string, Dog[]>([["home", [new Dog("rex")]]]);
  const wide: Map<string, Animal[]> = packs;
  wide.get("home")?.push(new Cat("tom"));
  wide.set("away", [new Cat("kit")]);
  return [...packs.values()].map(pack => pack.map(dog => dog.legs));
});

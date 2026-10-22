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

function legsPlusOne(dogs: Dog[], index: number): number {
  return dogs[index].legs + 1;
}

function tagLength(dogs: Dog[], index: number): number {
  return dogs[index].tag.length;
}

function tagText(dogs: Dog[], index: number): string {
  return dogs[index].tag + "!";
}

function ownerId(dogs: Dog[], index: number): number {
  return dogs[index].owner.id;
}

function bark(dogs: Dog[], index: number): string {
  return dogs[index].bark();
}

function nameOf(dogs: Dog[], index: number): string {
  return dogs[index].name;
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}

function allBark(dogs: Dog[]): string {
  let text = "";
  for (const dog of dogs) text += dog.bark() + ";";
  return text;
}

function isDog(dogs: Dog[], index: number): boolean {
  return dogs[index] instanceof Dog;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [new Dog("a"), new Dog("b")];
  warm += legsPlusOne(honest, 1) + tagLength(honest, 1) + tagText(honest, 1).length + ownerId(honest, 1) + bark(honest, 1).length;
  warm += nameOf(honest, 1).length + totalLegs(honest) + allBark(honest).length + (isDog(honest, 1) ? 1 : 0);
}
console.log("after 2000 honest kennels", warm);

const dogs: Dog[] = [new Dog("rex")];
const animals: Animal[] = dogs;
animals.push(new Cat("tom"));
dogs.push(new Dog("fido"));

console.log("one array", animals === dogs, dogs.length);
for (let index = 0; index < 3; index++) {
  attempt(index + ": name", () => nameOf(dogs, index));
  attempt(index + ": legs + 1", () => legsPlusOne(dogs, index));
  attempt(index + ": length of the tag", () => tagLength(dogs, index));
  attempt(index + ": the tag and a mark", () => tagText(dogs, index));
  attempt(index + ": id of the owner", () => ownerId(dogs, index));
  attempt(index + ": bark", () => bark(dogs, index));
  attempt(index + ": instanceof Dog", () => isDog(dogs, index));
  attempt(index + ": read in place", () => [dogs[index].legs, dogs[index].tag, typeof dogs[index].owner, typeof dogs[index].bark]);
  attempt(index + ": keys", () => Object.keys(dogs[index]));
  attempt(index + ": the whole element", () => dogs[index]);
}
attempt("total legs", () => totalLegs(dogs));
attempt("all bark", () => allBark(dogs));
attempt("a store to the cat's legs through dogs", () => {
  dogs[1].legs = 3;
  return [dogs[1].legs, Object.keys(dogs[1]), totalLegs(dogs)];
});
attempt("legs++ on a fresh cat", () => {
  const kennel: Dog[] = [];
  const wide: Animal[] = kennel;
  wide.push(new Cat("kit"));
  kennel[0].legs++;
  return [kennel[0].legs, Object.keys(kennel[0])];
});
attempt("an honest kennel again", () => {
  const honest = [new Dog("a"), new Dog("b")];
  return [legsPlusOne(honest, 1), tagLength(honest, 1), ownerId(honest, 1), bark(honest, 1), totalLegs(honest)];
});

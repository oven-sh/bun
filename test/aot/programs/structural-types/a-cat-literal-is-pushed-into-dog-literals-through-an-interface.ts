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

interface Animal {
  name: string;
}

interface Dog extends Animal {
  legs: number;
  tag: string;
  owner: { id: number };
  bark(): string;
}

interface Cat extends Animal {
  lives: string;
  indoor: boolean;
}

function makeDog(name: string): Dog {
  return {
    name,
    legs: 4,
    tag: "dog tag",
    owner: { id: 7 },
    bark() {
      return this.name + " barks on " + this.legs;
    },
  };
}

function makeCat(name: string): Cat {
  return { name, lives: "nine", indoor: true };
}

function legsPlusOne(dog: Dog): number {
  return dog.legs + 1;
}

function tagLength(dog: Dog): number {
  return dog.tag.length;
}

function ownerId(dog: Dog): number {
  return dog.owner.id;
}

function bark(dog: Dog): string {
  return dog.bark();
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (const dog of dogs) total += dog.legs;
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const dog = makeDog("d" + i);
  warm += legsPlusOne(dog) + tagLength(dog) + ownerId(dog) + bark(dog).length + totalLegs([dog, dog]);
}
console.log("after 2000 honest dogs", warm);

const dogs: Dog[] = [makeDog("rex")];
const animals: Animal[] = dogs;
animals.push(makeCat("tom"));
animals.push({ name: "only a name" });
const legsFirst = { legs: 3, name: "legs first", bark: () => "other order", owner: { id: 1 }, tag: "t" };
dogs.push(legsFirst);
const legsAsText = { name: "legs as text", legs: "four" };
animals.push(legsAsText);

for (let index = 0; index < dogs.length; index++) {
  attempt(index + ": name", () => dogs[index].name);
  attempt(index + ": legs + 1", () => legsPlusOne(dogs[index]));
  attempt(index + ": legs * 2 in place", () => dogs[index].legs * 2);
  attempt(index + ": length of the tag", () => tagLength(dogs[index]));
  attempt(index + ": id of the owner", () => ownerId(dogs[index]));
  attempt(index + ": bark", () => bark(dogs[index]));
  attempt(index + ": keys", () => Object.keys(dogs[index]));
  attempt(index + ": JSON", () => JSON.stringify(dogs[index]));
}
attempt("total legs", () => totalLegs(dogs));
attempt("legs by map", () => dogs.map(dog => dog.legs));
attempt("typeof legs by map", () => dogs.map(dog => typeof dog.legs));

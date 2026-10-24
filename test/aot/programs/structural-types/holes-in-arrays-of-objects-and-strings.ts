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

function legsAt(dogs: Dog[], index: number): number {
  return dogs[index].legs;
}

function nameOrNothing(dogs: Dog[], index: number): string {
  return dogs[index]?.name ?? "nobody";
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (const dog of dogs) total += dog.legs;
  return total;
}

function countDogs(dogs: Dog[]): number[] {
  let visited = 0;
  dogs.forEach(() => visited++);
  return [visited, dogs.length, dogs.filter(dog => dog instanceof Dog).length];
}

function lengthAt(texts: string[], index: number): number {
  return texts[index].length;
}

function glued(texts: string[]): string {
  let all = "";
  for (let i = 0; i < texts.length; i++) all += texts[i];
  return all;
}

function flagsSet(flags: boolean[]): number {
  let count = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i]) count++;
  return count;
}

function flagKinds(flags: boolean[]): string[] {
  const kinds: string[] = [];
  for (let i = 0; i < flags.length; i++) kinds.push(typeof flags[i] + " " + (flags[i] === false) + " " + (i in flags));
  return kinds;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const dogs = [new Dog("a"), new Dog("b")];
  warm += legsAt(dogs, 1) + nameOrNothing(dogs, 0).length + totalLegs(dogs) + countDogs(dogs)[0] + lengthAt(["ab", "c"], 0) + glued(["a", "b"]).length + flagsSet([true, false]) + flagKinds([true]).length;
}
console.log("after 2000 dense arrays", warm);

attempt("new Array<Dog>(2): legs", () => legsAt(new Array<Dog>(2), 0));
attempt("new Array<Dog>(2): name or nothing", () => nameOrNothing(new Array<Dog>(2), 0));
attempt("new Array<Dog>(2): total legs", () => totalLegs(new Array<Dog>(2)));
attempt("new Array<Dog>(2): counted", () => countDogs(new Array<Dog>(2)));
attempt("new Array<Dog>(2): elements", () => {
  const dogs = new Array<Dog>(2);
  return [dogs[0], typeof dogs[0], 0 in dogs, dogs[0] === undefined, dogs[0] == null];
});
attempt("one dog and a hole", () => {
  const dogs = new Array<Dog>(2);
  dogs[1] = new Dog("rex");
  return [nameOrNothing(dogs, 0), nameOrNothing(dogs, 1), legsAt(dogs, 1), countDogs(dogs)];
});
attempt("one dog and a hole: total legs", () => {
  const dogs = new Array<Dog>(2);
  dogs[1] = new Dog("rex");
  return totalLegs(dogs);
});
attempt("a dog is deleted", () => {
  const dogs = [new Dog("rex"), new Dog("fido")];
  delete dogs[0];
  return [nameOrNothing(dogs, 0), countDogs(dogs), Object.keys(dogs)];
});
attempt("the kennel is made longer", () => {
  const dogs = [new Dog("rex")];
  dogs.length = 3;
  return [nameOrNothing(dogs, 2), countDogs(dogs)];
});
attempt("the kennel is made longer: legs", () => {
  const dogs = [new Dog("rex")];
  dogs.length = 3;
  return legsAt(dogs, 2);
});
attempt("an empty kennel destructured", () => {
  const [first]: Dog[] = [];
  return first.legs;
});
attempt("new Array<string>(2): length of the first", () => lengthAt(new Array<string>(2), 0));
attempt("new Array<string>(2): glued", () => glued(new Array<string>(2)));
attempt("new Array<string>(2): joined", () => new Array<string>(3).join("-"));
attempt("new Array<string>(2): elements", () => {
  const texts = new Array<string>(2);
  return [texts[0], typeof texts[0], texts[0] + "!", `${texts[0]}`, texts[0] === "", !texts[0]];
});
attempt("a text and a hole", () => {
  const texts = new Array<string>(2);
  texts[0] = "a";
  return [glued(texts), texts.sort(), texts.indexOf("a"), texts.map(text => text.toUpperCase())];
});
attempt("new Array<boolean>(3)", () => [flagsSet(new Array<boolean>(3)), flagKinds(new Array<boolean>(3))]);
attempt("flags and a hole", () => {
  const flags = new Array<boolean>(3);
  flags[1] = true;
  flags[2] = false;
  return [flagsSet(flags), flagKinds(flags)];
});
attempt("new Array<number[]>(2)", () => {
  const rows = new Array<number[]>(2);
  rows[1] = new Array<number>(2);
  return [typeof rows[0], rows[1].length, rows[1][0], rows.map(row => row.length)];
});
attempt("new Array<number[]>(2): a read through the hole", () => new Array<number[]>(2)[0][0]);
attempt("a grid made of holes", () => {
  const grid = Array.from({ length: 2 }, () => new Array<number>(2));
  grid[0][1] = 5;
  let total = 0;
  for (const row of grid) for (const cell of row) total += cell ?? 1;
  return [total, grid, grid[0] === grid[1]];
});
attempt("a grid made by fill shares one row", () => {
  const grid = new Array<number[]>(2).fill(new Array<number>(2));
  grid[0][1] = 5;
  return [grid, grid[0] === grid[1]];
});

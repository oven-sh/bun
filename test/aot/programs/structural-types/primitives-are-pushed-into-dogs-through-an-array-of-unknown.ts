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

function legsPlusOne(dogs: Dog[], index: number): number {
  return dogs[index].legs + 1;
}

function tagAt(dogs: Dog[], index: number): string {
  return dogs[index].tag;
}

function nameAt(dogs: Dog[], index: number): string {
  return dogs[index].name;
}

function barkAt(dogs: Dog[], index: number): string {
  return dogs[index].bark();
}

function kindAt(dogs: Dog[], index: number): string {
  return typeof dogs[index];
}

function isDogAt(dogs: Dog[], index: number): boolean {
  return dogs[index] instanceof Dog;
}

function truthyAt(dogs: Dog[], index: number): boolean {
  return dogs[index] ? true : false;
}

function storeLegs(dogs: Dog[], index: number): number {
  dogs[index].legs = 3;
  return dogs[index].legs;
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (const dog of dogs) total += dog.legs;
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [new Dog("a"), new Dog("b")];
  warm += legsAt(honest, 1) + legsPlusOne(honest, 1) + tagAt(honest, 1).length + nameAt(honest, 1).length + barkAt(honest, 1).length + kindAt(honest, 1).length;
  warm += (isDogAt(honest, 1) ? 1 : 0) + (truthyAt(honest, 1) ? 1 : 0) + storeLegs(honest, 1) + totalLegs(honest);
}
console.log("after 2000 honest kennels", warm);

const visitors: [string, unknown][] = [
  ["5", 5],
  ["0", 0],
  ["2.5", 2.5],
  ["NaN", NaN],
  ["a string", "text"],
  ["an empty string", ""],
  ["true", true],
  ["false", false],
  ["null", null],
  ["undefined", undefined],
  ["a symbol", Symbol("s")],
  ["a bigint", 5n],
  ["a function", legsAt],
  ["an array", [1]],
  ["an empty object", {}],
];
for (const [name, visitor] of visitors) {
  const make = (): Dog[] => {
    const dogs = [new Dog("rex")];
    const things: unknown[] = dogs;
    things.push(visitor);
    return dogs;
  };
  attempt(name + ": typeof", () => kindAt(make(), 1));
  attempt(name + ": legs", () => legsAt(make(), 1));
  attempt(name + ": legs + 1", () => legsPlusOne(make(), 1));
  attempt(name + ": tag", () => tagAt(make(), 1));
  attempt(name + ": name", () => nameAt(make(), 1));
  attempt(name + ": bark", () => barkAt(make(), 1));
  attempt(name + ": instanceof Dog", () => isDogAt(make(), 1));
  attempt(name + ": truthy", () => truthyAt(make(), 1));
  attempt(name + ": a store to its legs", () => storeLegs(make(), 1));
  attempt(name + ": total legs", () => totalLegs(make()));
}
attempt("honest again", () => [legsAt([new Dog("a")], 0), barkAt([new Dog("a")], 0)]);

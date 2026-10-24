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

class Home {
  street = "main";
  pet: Dog = new Dog("rex");
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
  petKind(): string {
    return typeof this.pet;
  }
  hasPet(): boolean {
    return this.pet ? true : false;
  }
}

function legsOf(home: { pet: Dog }): number {
  return home.pet.legs + 1;
}

function nameOf(home: { pet: Dog }): string {
  return home.pet.name;
}

function barkOf(home: { pet: Dog }): string {
  return home.pet.bark();
}

function put(home: { pet: unknown }, value: unknown): void {
  home.pet = value;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const home = new Home();
  const literal = { pet: new Dog("d") };
  put(home, new Dog("e"));
  put(literal, new Dog("f"));
  warm += home.legs() + home.petKind().length + (home.hasPet() ? 1 : 0) + legsOf(home) + legsOf(literal) + nameOf(literal).length + barkOf(home).length;
}
console.log("after 2000 honest homes", warm);

const visitors: [string, unknown][] = [
  ["5", 5],
  ["0", 0],
  ["-0", -0],
  ["2.5", 2.5],
  ["NaN", NaN],
  ["2 ** 40", 2 ** 40],
  ["a string", "text"],
  ["an empty string", ""],
  ["true", true],
  ["false", false],
  ["null", null],
  ["undefined", undefined],
  ["a symbol", Symbol("s")],
  ["a bigint", 5n],
  ["a function", legsOf],
  ["an empty object", {}],
];
for (const [name, visitor] of visitors) {
  attempt(name + " in an instance: what is held", () => {
    const home = new Home();
    put(home, visitor);
    const held: unknown = home.pet;
    return [home.petKind(), held, Object.is(held, visitor), home.hasPet(), home.street, home.number];
  });
  attempt(name + " in an instance: legs + 1", () => {
    const home = new Home();
    put(home, visitor);
    return [home.legs(), legsOf(home)];
  });
  attempt(name + " in an instance: name", () => {
    const home = new Home();
    put(home, visitor);
    return nameOf(home);
  });
  attempt(name + " in an instance: bark", () => {
    const home = new Home();
    put(home, visitor);
    return barkOf(home);
  });
  attempt(name + " in a literal", () => {
    const home = { before: 1, pet: new Dog("rex"), after: 2 };
    put(home, visitor);
    const held: unknown = home.pet;
    return [typeof home.pet, held, home.before, home.after, JSON.stringify(Object.keys(home))];
  });
  attempt(name + " in a literal: legs + 1", () => {
    const home = { pet: new Dog("rex") };
    put(home, visitor);
    return legsOf(home);
  });
  attempt(name + ": a dog comes back", () => {
    const home = new Home();
    put(home, visitor);
    put(home, new Dog("back"));
    return [home.legs(), barkOf(home)];
  });
}

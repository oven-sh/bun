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
  bark(): string {
    return this.pet.bark();
  }
}

function legsOf(home: { pet: Dog }): number {
  return home.pet.legs + 1;
}

function tagOf(home: { pet: Dog }): number {
  return home.pet.tag.length;
}

function ownerOf(home: { pet: Dog }): number {
  return home.pet.owner.id;
}

function barkOf(home: { pet: Dog }): string {
  return home.pet.bark();
}

function adopt(home: { pet: Animal }, animal: Animal): void {
  home.pet = animal;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const literal = { pet: new Dog("d") };
  const home = new Home();
  warm += legsOf(literal) + tagOf(literal) + ownerOf(literal) + barkOf(literal).length + legsOf(home) + home.legs() + home.bark().length;
  adopt(literal, new Dog("e"));
  adopt(home, new Dog("f"));
  warm += legsOf(literal) + home.legs();
}
console.log("after 2000 honest homes", warm);

function report(name: string, home: { pet: Dog }): void {
  attempt(name + ": legs + 1", () => legsOf(home));
  attempt(name + ": length of the tag", () => tagOf(home));
  attempt(name + ": id of the owner", () => ownerOf(home));
  attempt(name + ": bark", () => barkOf(home));
  attempt(name + ": in place", () => [home.pet.name, home.pet.legs, home.pet.tag, home.pet instanceof Dog]);
}

{
  const home = { pet: new Dog("rex") };
  const wide: { pet: Animal } = home;
  wide.pet = new Cat("tom");
  report("a literal, by an alias", home);
}
{
  const home = { pet: new Dog("rex") };
  adopt(home, new Cat("tom"));
  report("a literal, in a callee", home);
}
{
  const home = new Home();
  adopt(home, new Cat("tom"));
  report("an instance, in a callee", home);
  attempt("an instance: its own methods", () => [home.legs(), home.street, home.number]);
  attempt("an instance: its own bark", () => home.bark());
}
{
  const home = new Home();
  adopt(home, new Animal("plain"));
  report("an instance gets a plain animal", home);
}
{
  const home = { pet: new Dog("rex") };
  adopt(home, { name: "only a name" });
  report("a literal gets a literal", home);
}
{
  const fixed: { readonly pet: Dog } = { pet: new Dog("rex") };
  adopt(fixed, new Cat("tom"));
  attempt("a readonly member", () => [fixed.pet.legs, fixed.pet.name]);
}
{
  const town = { home: { pet: new Dog("rex") } };
  const wide: { home: { pet: Animal } } = town;
  wide.home.pet = new Cat("tom");
  attempt("nested: the inner member", () => town.home.pet.legs + 1);
  wide.home = { pet: new Cat("kit") };
  attempt("nested: the outer member", () => [town.home.pet.legs + 1, town.home.pet.name]);
}
attempt("in the middle of a loop", () => {
  const home = new Home();
  const wide: { pet: Animal } = home;
  let total = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1500) wide.pet = new Cat("tom");
    if (i === 1510) wide.pet = new Dog("back");
    total += Number.isNaN(home.pet.legs + 0) ? 1000 : home.pet.legs;
  }
  return total;
});
attempt("null through an alias", () => {
  const home = new Home();
  const wide: { pet: Dog | null } = home;
  wide.pet = null;
  return home.legs();
});
attempt("undefined through an alias", () => {
  const home = new Home();
  const wide: { pet?: Dog } = home;
  wide.pet = undefined;
  return [Object.keys(home), home.pet === undefined, home.legs()];
});
attempt("deleted through an alias", () => {
  const home = new Home();
  const wide: { pet?: Dog } = home;
  delete wide.pet;
  return [Object.keys(home), "pet" in home, home.pet === undefined];
});
report("an honest home again", new Home());

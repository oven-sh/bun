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

function legsOf(dogs: Record<string, Dog>, name: string): number {
  return dogs[name].legs + 1;
}

function barkOf(dogs: Record<string, Dog>, name: string): string {
  return dogs[name].bark();
}

function totalLegs(dogs: { [name: string]: Dog }): number {
  let total = 0;
  for (const name in dogs) total += dogs[name].legs;
  return total;
}

function totalByValues(dogs: Record<string, Dog>): number {
  let total = 0;
  for (const dog of Object.values(dogs)) total += dog.legs;
  return total;
}

function sum(counts: Record<string, number>): number {
  let total = 0;
  for (const key of Object.keys(counts)) total += counts[key];
  return total;
}

function admit(animals: Record<string, Animal>, animal: Animal): void {
  animals[animal.name] = animal;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Record<string, Dog> = { a: new Dog("a"), b: new Dog("b") };
  warm += legsOf(honest, "a") + barkOf(honest, "b").length + totalLegs(honest) + totalByValues(honest) + sum({ x: i, y: 0.5 });
}
console.log("after 2000 honest records", warm);

const dogs: Record<string, Dog> = { rex: new Dog("rex") };
const animals: Record<string, Animal> = dogs;
animals.tom = new Cat("tom");
admit(dogs, new Cat("kit"));
dogs.fido = new Dog("fido");

for (const name of ["rex", "tom", "kit", "fido", "nobody", "constructor", "__proto__", "toString"]) {
  attempt(name + ": legs + 1", () => legsOf(dogs, name));
  attempt(name + ": bark", () => barkOf(dogs, name));
  attempt(name + ": typeof", () => typeof dogs[name]);
}
attempt("total legs", () => totalLegs(dogs));
attempt("total by values", () => totalByValues(dogs));
attempt("keys", () => Object.keys(dogs));

attempt("a declared member is stored to under a computed key", () => {
  const home = { pet: new Dog("rex"), guard: new Dog("max") };
  const shelf: Record<string, Animal> = home;
  for (const key of ["pet"]) shelf[key] = new Cat("tom");
  return [home.pet.legs, home.guard.legs, home.pet.name, Object.keys(home)];
});
attempt("a new member appears beside the declared ones", () => {
  const home = { pet: new Dog("rex") };
  const shelf: Record<string, Animal> = home;
  shelf.extra = new Cat("tom");
  return [Object.keys(home), JSON.stringify(home).length, home.pet.legs];
});
attempt("counts get a string", () => {
  const counts: Record<string, number> = { a: 1, b: 2 };
  const wide: Record<string, number | string> = counts;
  wide.c = "3";
  return [sum(counts), counts.c * 2, typeof counts.c];
});
attempt("declared numbers get a string under a computed key", () => {
  const point = { x: 1, y: 2 };
  const wide: Record<string, number | string> = point;
  for (const key of ["y"]) wide[key] = "two";
  return [point.x + point.y, point.y * 2, typeof point.y];
});
attempt("numeric keys", () => {
  const byId: Record<number, Dog> = { 1: new Dog("one") };
  const wide: Record<number, Animal> = byId;
  wide[2] = new Cat("two");
  return [byId[1].legs, byId[2].legs, byId[3]?.legs, Object.keys(byId)];
});

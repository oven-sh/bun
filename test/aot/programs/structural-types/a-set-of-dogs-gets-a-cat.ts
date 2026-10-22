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

function totalLegs(dogs: Set<Dog>): number {
  let total = 0;
  for (const dog of dogs) total += dog.legs;
  return total;
}

function barks(dogs: Set<Dog>): string {
  let text = "";
  dogs.forEach(dog => {
    text += dog.bark() + ";";
  });
  return text;
}

function tags(dogs: Set<Dog>): string[] {
  return [...dogs].map(dog => dog.tag);
}

function sum(numbers: Set<number>): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function add(animals: Set<Animal>, animal: Animal): void {
  animals.add(animal);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Set([new Dog("a"), new Dog("b")]);
  warm += totalLegs(honest) + barks(honest).length + tags(honest).length + sum(new Set([i, 1, 2.5]));
}
console.log("after 2000 honest sets", warm);

const dogs = new Set<Dog>([new Dog("rex")]);
const animals: Set<Animal> = dogs;
const tom = new Cat("tom");
animals.add(tom);
add(dogs, new Cat("kit"));
dogs.add(new Dog("fido"));

attempt("size", () => dogs.size);
attempt("total legs", () => totalLegs(dogs));
attempt("tags", () => tags(dogs));
attempt("barks", () => barks(dogs));
attempt("names", () => [...dogs].map(dog => dog.name + ":" + dog.constructor.name));
attempt("the cat is a member", () => animals.has(tom));
attempt("entries", () => {
  const seen: unknown[] = [];
  for (const [first, second] of dogs.entries()) seen.push(first.legs, first === second);
  return seen;
});
attempt("numbers get a string", () => {
  const numbers = new Set<number>([1, 2]);
  const wide: Set<number | string> = numbers;
  wide.add("3");
  return [sum(numbers), [...numbers].map(number => typeof number), Math.max(...numbers)];
});
attempt("numbers get undefined", () => {
  const numbers = new Set<number>([1, 2]);
  const wide: Set<number | undefined> = numbers;
  wide.add(undefined);
  return [sum(numbers), numbers.size];
});
attempt("a readonly set changes under its reader", () => {
  const numbers = new Set<number>([1, 2]);
  const view: ReadonlySet<number> = numbers;
  const before = [view.size, view.has(3)];
  numbers.add(3);
  numbers.delete(1);
  return [...before, view.size, view.has(3), view.has(1)];
});
attempt("added to while it is iterated", () => {
  const numbers = new Set<number>([1]);
  const wide: Set<number | string> = numbers;
  let total = 0;
  for (const number of numbers) {
    total += number;
    if (numbers.size < 3) wide.add("s" + numbers.size);
  }
  return total;
});
attempt("a union of sets", () => {
  const more: Set<Animal> = new Set<Animal>([new Cat("c")]);
  const both = animals.union(more);
  return [both.size, dogs.size];
});

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

function first<T>(items: T[]): T {
  return items[0];
}

function last<T>(items: T[]): T {
  return items[items.length - 1];
}

function pick<T>(items: T[], index: number): T {
  return items[index];
}

function mapAll<T, U>(items: T[], change: (item: T) => U): U[] {
  const result: U[] = [];
  for (const item of items) result.push(change(item));
  return result;
}

function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  return items.map(item => item[key]);
}

function append<T>(items: T[], item: T): T[] {
  items.push(item);
  return items;
}

function swap<T>(items: T[], a: number, b: number): void {
  [items[a], items[b]] = [items[b], items[a]];
}

function copy<T>(items: readonly T[]): T[] {
  return [...items];
}

function polluted(): Dog[] {
  const dogs = [new Dog("rex"), new Dog("fido")];
  const animals: Animal[] = dogs;
  animals.unshift(new Cat("tom"));
  animals.push(new Cat("kit"));
  return dogs;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [new Dog("a"), new Dog("b")];
  warm += first(honest).legs + last(honest).legs + pick(honest, 1).legs + mapAll(honest, dog => dog.legs)[0] + pluck(honest, "legs")[1];
  warm += first([i]) + last(["x"]).length + copy(honest)[0].legs;
}
console.log("after 2000 honest arrays", warm);

attempt("first: legs", () => first(polluted()).legs + 1);
attempt("first: bark", () => first(polluted()).bark());
attempt("first: tag", () => first(polluted()).tag.length);
attempt("last: legs", () => last(polluted()).legs + 1);
attempt("pick 1: legs", () => pick(polluted(), 1).legs + 1);
attempt("pick 3: owner", () => pick(polluted(), 3).owner.id);
attempt("pick 9: legs", () => pick(polluted(), 9).legs);
attempt("map: legs", () => mapAll(polluted(), dog => dog.legs));
attempt("map: legs * 2", () => mapAll(polluted(), dog => dog.legs * 2));
attempt("pluck legs", () => pluck(polluted(), "legs"));
attempt("pluck tag", () => pluck(polluted(), "tag"));
attempt("sum of plucked legs", () => {
  let total = 0;
  for (const legs of pluck(polluted(), "legs")) total += legs;
  return total;
});
attempt("a copy", () => copy(polluted()).map(dog => dog.legs));
attempt("swapped", () => {
  const dogs = polluted();
  swap(dogs, 0, 1);
  return [dogs[0].legs, dogs[1].legs, dogs[0].name, dogs[1].name];
});
attempt("a wider type argument stores a cat", () => {
  const dogs = [new Dog("rex")];
  append<Animal>(dogs, new Cat("tom"));
  return [dogs[1].legs, dogs.length];
});
attempt("the type argument is inferred as the wider one", () => {
  const dogs = [new Dog("rex")];
  const animal: Animal = new Cat("tom");
  append(dogs, animal);
  return [last(dogs).legs, last(dogs).name];
});
attempt("numbers and a string", () => {
  const numbers = [1, 2];
  append<number | string>(numbers, "3");
  return [first(numbers) + last(numbers), last(numbers) * 2, mapAll(numbers, number => number + 1)];
});
attempt("honest again", () => [first([new Dog("a")]).legs, last([1, 2]), pluck([new Dog("b")], "tag")]);

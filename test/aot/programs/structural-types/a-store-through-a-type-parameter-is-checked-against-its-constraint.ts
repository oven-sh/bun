function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

class Cat extends Animal {
  lives = "nine";
}

function rehome<T extends { pet: Animal }>(home: T): T {
  home.pet = new Cat();
  return home;
}

function rehomeByName<T extends { pet: Animal }>(home: T): void {
  home["pet"] = new Cat();
}

function relabel<T extends { label: string | number }>(o: T): void {
  o.label = "text";
}

function clear<T extends { next: object | null }>(o: T): void {
  o.next = null;
}

function refill<T extends { items: (number | string)[] }>(o: T): void {
  o.items = ["a", "b"];
}

function add<T>(list: T[], item: T): void {
  list.push(item);
}

function put<T>(o: T, key: keyof T, value: T[keyof T]): void {
  o[key] = value;
}

function swap<T, K extends keyof T>(o: T, a: K, b: K): void {
  const kept = o[a];
  o[a] = o[b];
  o[b] = kept;
}

class Kennel {
  pet: Dog = new Dog();
  legs(): number {
    return this.pet.legs + 1;
  }
  noise(): number {
    return this.pet.bark();
  }
}

attempt("honest", () => [new Kennel().legs(), new Kennel().noise()]);
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const dogs: Dog[] = [];
  add(dogs, new Dog());
  warm += new Kennel().legs() + new Kennel().noise() + dogs[0].bark();
}
console.log("2000 honest rounds", warm);

attempt("a literal kennel: field", () => rehome({ pet: new Dog() }).pet.legs);
attempt("a literal kennel: method", () => rehome({ pet: new Dog() }).pet.bark());
attempt("a class kennel: field", () => rehome(new Kennel()).legs());
attempt("a class kennel: method", () => rehome(new Kennel()).noise());
attempt("by a quoted name", () => {
  const k = new Kennel();
  rehomeByName(k);
  return k.legs();
});
attempt("a number label", () => {
  const o = { label: 1 };
  relabel(o);
  return [o.label + 1, typeof o.label];
});
attempt("a next that was never null", () => {
  const o = { next: { n: 1 } };
  clear(o);
  return o.next.n;
});
attempt("a list of numbers", () => {
  const o: { items: number[] } = { items: [1, 2] };
  refill(o);
  let sum = 0;
  for (let i = 0; i < o.items.length; i++) sum += o.items[i];
  return sum;
});
attempt("a wider type argument", () => {
  const dogs: Dog[] = [new Dog()];
  add<Animal>(dogs, new Cat());
  return dogs.map(d => d.legs);
});
attempt("a wider type argument, then a method", () => {
  const dogs: Dog[] = [new Dog()];
  add<Animal>(dogs, new Cat());
  return dogs.map(d => d.bark());
});
attempt("numbers get a string", () => {
  const numbers: number[] = [1, 2];
  add<number | string>(numbers, "3");
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum;
});
attempt("any key, any member's type", () => {
  const d = new Dog();
  put(d, "legs", "text");
  return [d.legs * 2, d.legs + 1, d.bark()];
});
attempt("any key, any member's type: the method", () => {
  const d = new Dog();
  put(d, "bark", 5);
  return d.bark();
});
attempt("two keys of different types swapped", () => {
  const o = { n: 1, s: "text" };
  swap(o, "n", "s");
  return [o.n + 1, typeof o.s];
});
attempt("two keys of different types swapped, then a string method", () => {
  const o = { n: 1, s: "text" };
  swap(o, "n", "s");
  return o.s.toUpperCase();
});
attempt("honest again", () => [new Kennel().legs(), new Kennel().noise()]);

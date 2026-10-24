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

const keys = [{ id: 0 }, { id: 1 }, { id: 2 }];

function legsOf(dogs: WeakMap<object, Dog>, key: object): number {
  const dog = dogs.get(key);
  return dog === undefined ? -1 : dog.legs * 2;
}

function barkOf(dogs: WeakMap<object, Dog>, key: object): string {
  const dog = dogs.get(key);
  return dog === undefined ? "nobody" : dog.bark();
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new WeakMap<object, Dog>([[keys[0], new Dog("a")]]);
  warm += legsOf(honest, keys[0]) + legsOf(honest, keys[1]) + barkOf(honest, keys[0]).length;
}
console.log("after 2000 honest weak maps", warm);

const dogs = new WeakMap<object, Dog>([[keys[0], new Dog("rex")]]);
const animals: WeakMap<object, Animal> = dogs;
animals.set(keys[1], new Cat("tom"));

for (const key of keys) {
  attempt(key.id + ": legs * 2", () => legsOf(dogs, key));
  attempt(key.id + ": bark", () => barkOf(dogs, key));
  attempt(key.id + ": tag", () => dogs.get(key)?.tag);
}
attempt("dogs as keys", () => {
  const ages = new WeakMap<Dog, number>();
  const wide: WeakMap<Animal, number> = ages;
  const tom = new Cat("tom");
  wide.set(tom, 5);
  return wide.get(tom);
});
attempt("a box with a weak reference", () => {
  const rex = new Dog("rex");
  const tom = new Cat("tom");
  const box: { ref: WeakRef<Dog> } = { ref: new WeakRef(rex) };
  const wide: { ref: WeakRef<Animal> } = box;
  const before = box.ref.deref()?.legs;
  wide.ref = new WeakRef(tom);
  return [before, box.ref.deref()?.legs, box.ref.deref()?.name];
});
attempt("a weak set", () => {
  const seen = new WeakSet<Dog>();
  const wide: WeakSet<Animal> = seen;
  const tom = new Cat("tom");
  wide.add(tom);
  return wide.has(tom);
});

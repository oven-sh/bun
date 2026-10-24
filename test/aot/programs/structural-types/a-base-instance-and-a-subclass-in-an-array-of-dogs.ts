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

class Puppy extends Dog {
  age = 0.5;
  legs = 5;
  bark(): string {
    return this.name + " yips at " + this.age;
  }
}

class Wolf extends Dog {
  constructor(name: string) {
    super(name);
    this.tag = "";
    this.owner = { id: -1 };
  }
  get pack(): string {
    return "pack of " + this.name;
  }
}

function legsPlusOne(dog: Dog): number {
  return dog.legs + 1;
}

function bark(dog: Dog): string {
  return dog.bark();
}

function tagLength(dog: Dog): number {
  return dog.tag.length;
}

function ownerId(dog: Dog): number {
  return dog.owner.id;
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const dog = new Dog("d");
  warm += legsPlusOne(dog) + bark(dog).length + tagLength(dog) + ownerId(dog) + totalLegs([dog, dog]);
}
console.log("after 2000 plain dogs", warm);

const dogs: Dog[] = [new Dog("rex"), new Puppy("pip"), new Wolf("grey")];
const animals: Animal[] = dogs;
animals.push(new Animal("plain"));
animals.push(Object.create(Dog.prototype, { name: { value: "hollow", enumerable: true } }));
animals.push(Object.assign(new Cat("dressed"), { legs: 4, tag: "fake", owner: { id: 3 }, bark: () => "meow" }));
animals.push(Object.setPrototypeOf(new Dog("reparented"), Cat.prototype));
animals.push(new Proxy(new Dog("proxied"), { get: (target, key, receiver) => (key === "legs" ? 40 : Reflect.get(target, key, receiver)) }));

for (const dog of dogs) {
  attempt(dog.name + ": legs + 1", () => legsPlusOne(dog));
  attempt(dog.name + ": bark", () => bark(dog));
  attempt(dog.name + ": length of the tag", () => tagLength(dog));
  attempt(dog.name + ": id of the owner", () => ownerId(dog));
  attempt(dog.name + ": instanceof", () => [dog instanceof Dog, dog instanceof Animal, dog instanceof Cat, dog.constructor.name]);
  attempt(dog.name + ": keys", () => Object.keys(dog));
}
attempt("total legs", () => totalLegs(dogs));
attempt("puppies only", () => {
  const puppies: Puppy[] = [new Puppy("a")];
  const wide: Dog[] = puppies;
  wide.push(new Dog("grown"));
  return puppies.map(puppy => [puppy.age * 2, puppy.bark(), puppy.legs]);
});

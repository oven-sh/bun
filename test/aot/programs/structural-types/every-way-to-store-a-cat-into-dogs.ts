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

function helper(list: Animal[], animal: Animal): void {
  list[0] = animal;
}

function genericPush<T>(list: T[], item: T): void {
  list.push(item);
}

const ways: [string, (animals: Animal[], cat: Cat) => void][] = [
  ["push", (animals, cat) => void animals.push(cat)],
  ["an index store", (animals, cat) => void (animals[1] = cat)],
  ["an index store past the end", (animals, cat) => void (animals[animals.length] = cat)],
  ["splice in", (animals, cat) => void animals.splice(1, 0, cat)],
  ["splice over", (animals, cat) => void animals.splice(0, 2, cat)],
  ["fill", (animals, cat) => void animals.fill(cat)],
  ["fill one", (animals, cat) => void animals.fill(cat, 1)],
  ["unshift", (animals, cat) => void animals.unshift(cat)],
  ["a destructuring assignment", (animals, cat) => void ([animals[0]] = [cat])],
  ["a swap by destructuring", (animals, cat) => void ([animals[0], animals[1]] = [cat, animals[0]])],
  ["an object pattern", (animals, cat) => void ({ cat: animals[1] } = { cat })],
  ["a for-of target", (animals, cat) => {
    for (animals[1] of [cat]);
  }],
  ["a helper", (animals, cat) => helper(animals, cat)],
  ["a generic helper", (animals, cat) => genericPush(animals, cat)],
  ["push.call", (animals, cat) => void Array.prototype.push.call(animals, cat)],
  ["Object.assign", (animals, cat) => void Object.assign(animals, [cat])],
  ["Reflect.set", (animals, cat) => void Reflect.set(animals, 1, cat)],
  ["defineProperty", (animals, cat) => void Object.defineProperty(animals, 1, { value: cat, writable: true, enumerable: true, configurable: true })],
  ["a getter at an index", (animals, cat) => void Object.defineProperty(animals, 1, { get: () => cat, enumerable: true, configurable: true })],
  ["a logical assignment", (animals, cat) => void (animals[5] ??= cat)],
];

function legs(dogs: Dog[]): unknown[] {
  const seen: unknown[] = [];
  for (let i = 0; i < dogs.length; i++) seen.push(i in dogs ? dogs[i].legs : "hole");
  return seen;
}

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (const dog of dogs) total += dog.legs;
  return total;
}

function barks(dogs: Dog[]): string {
  return dogs.map(dog => dog.bark()).join();
}

function names(dogs: Dog[]): string {
  return dogs.map(dog => dog.name + ":" + dog.constructor.name).join();
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [new Dog("a"), new Dog("b")];
  warm += legs(honest).length + totalLegs(honest) + barks(honest).length + names(honest).length;
}
console.log("after 2000 honest kennels", warm);

for (const [way, store] of ways) {
  const make = (): Dog[] => {
    const dogs = [new Dog("rex"), new Dog("fido")];
    store(dogs, new Cat("tom"));
    return dogs;
  };
  attempt(way + ": names", () => names(make()));
  attempt(way + ": legs", () => legs(make()));
  attempt(way + ": total legs", () => totalLegs(make()));
  attempt(way + ": barks", () => barks(make()));
}

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

class Box<T> {
  label = "box";
  value: T;
  stores = 0;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
  set(value: T): void {
    this.stores++;
    this.value = value;
  }
  map<U>(change: (value: T) => U): Box<U> {
    return new Box(change(this.value));
  }
}

interface Slot<T> {
  value: T;
}

function legsIn(box: Box<Dog>): number {
  return box.get().legs + 1;
}

function legsByField(box: Box<Dog>): number {
  return box.value.legs + 1;
}

function barkIn(box: Box<Dog>): string {
  return box.get().bark();
}

function twice(box: Box<number>): number {
  return box.get() * 2;
}

function fill(box: Box<Animal>, animal: Animal): void {
  box.set(animal);
}

function fillSlot(slot: Slot<Animal>, animal: Animal): void {
  slot.value = animal;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Box(new Dog("d"));
  fill(honest, new Dog("e"));
  warm += legsIn(honest) + legsByField(honest) + barkIn(honest).length + twice(new Box(i)) + new Box("text").get().length;
}
console.log("after 2000 honest boxes", warm);

function report(name: string, box: Box<Dog>): void {
  attempt(name + ": legs by the method", () => legsIn(box));
  attempt(name + ": legs by the field", () => legsByField(box));
  attempt(name + ": bark", () => barkIn(box));
  attempt(name + ": mapped", () => box.map(dog => dog.legs * 2).get());
  attempt(name + ": the other fields", () => [box.label, box.stores]);
}

{
  const box = new Box(new Dog("rex"));
  const wide: Box<Animal> = box;
  wide.set(new Cat("tom"));
  report("by the method of an alias", box);
}
{
  const box = new Box(new Dog("rex"));
  const wide: Box<Animal> = box;
  wide.value = new Cat("tom");
  report("by the field of an alias", box);
}
{
  const box = new Box(new Dog("rex"));
  fill(box, new Cat("tom"));
  report("in a callee", box);
}
{
  const box = new Box(new Dog("rex"));
  fillSlot(box, new Cat("tom"));
  report("as a slot", box);
}
attempt("a box of numbers gets a string", () => {
  const box = new Box(1);
  const wide: Box<number | string> = box;
  wide.set("one");
  return [twice(box), box.get() + 1, typeof box.value];
});
attempt("a box of numbers gets undefined", () => {
  const box = new Box(1);
  const wide: Box<number | undefined> = box;
  wide.set(undefined);
  return [twice(box), box.get() + 1, typeof box.value];
});
attempt("a box of strings gets a number", () => {
  const box = new Box("text");
  const wide: Box<string | number> = box;
  wide.set(5);
  return [box.get() + "!", typeof box.get(), box.get().length];
});
attempt("boxes of several types in one array", () => {
  const boxes: Box<{}>[] = [new Box(1), new Box("two"), new Box(new Dog("three")), new Box(4.5), new Box(true)];
  return boxes.map(box => box.get());
});
attempt("a box in a box", () => {
  const outer = new Box(new Box(new Dog("rex")));
  const wide: Box<Box<Animal>> = outer;
  wide.get().set(new Cat("tom"));
  const first = outer.get().get().legs;
  wide.set(new Box<Animal>(new Cat("kit")));
  return [first, outer.get().get().legs, outer.get().get().name];
});
attempt("a box of an array of dogs", () => {
  const box = new Box([new Dog("rex")]);
  const wide: Box<Animal[]> = box;
  wide.get().push(new Cat("tom"));
  return box.get().map(dog => dog.legs);
});
report("an honest box again", new Box(new Dog("rex")));

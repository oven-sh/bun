class Person {
  first: string;
  constructor(first: string) {
    this.first = first;
  }
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs: number = 4;
  tag: string = "rex-tag";
  owner: Person = new Person("ann");
  tricks: string[] = ["sit", "roll"];
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives: string = "nine";
  weight: number = 3.5;
  toys: number[] = [7, 8, 9];
  enemy: Person = new Person("bob");
  purr(): string {
    return this.name + " purrs";
  }
}

class Spider extends Animal {
  legs: string = "eight";
  tag: number = 88;
}

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function put<T>(o: T, k: keyof T, v: T[keyof T]): void {
  o[k] = v;
}
function set<T, K extends keyof T>(o: T, k: K, v: T[K]): void {
  o[k] = v;
}
function copy<T>(to: T, from: T, k: keyof T): void {
  to[k] = from[k];
}
function get<T, K extends keyof T>(o: T, k: K): T[K] {
  return o[k];
}

class Point {
  x: number = 1;
  y: number = 2;
  label: string = "p";
  sum(): number {
    return this.x + this.y;
  }
}

const rex = new Dog("rex");
show("before: legs", () => rex.legs);
put(rex, "legs", "text");
show("a string in legs", () => rex.legs);
show("legs * 2", () => rex.legs * 2);
show("legs + 1", () => rex.legs + 1);
show("bark", () => rex.bark());
put(rex, "tag", 5);
show("a number in tag", () => rex.tag);
show("tag length", () => rex.tag.length);
put(rex, "owner", ["not", "a", "person"]);
show("an array in owner", () => rex.owner);
show("owner's name", () => rex.owner.first);
put(rex, "tricks", new Person("zed"));
show("a person in tricks", () => rex.tricks);
show("tricks length", () => rex.tricks.length);
put(rex, "bark", "not a function");
show("a string in bark", () => rex.bark());
show("own keys", () => Object.keys(rex).join());

const fido = new Dog("fido");
const either: "legs" | "tag" = fido.name.length > 2 ? "legs" : "tag";
set(fido, either, "either");
show("a key that is one of two: legs", () => fido.legs);
show("a key that is one of two: legs - 1", () => fido.legs - 1);
set(fido, "legs", 3);
show("an honest set", () => fido.legs);
show("get", () => get(fido, "legs") + 1);
show("get by one of two", () => get(fido, either));

const p = new Point();
const q = new Point();
for (let i = 0; i < 2000; i++) set(p, "x", i);
show("2000 honest sets", () => p.sum());
put(p, "x", "ten");
show("then a string", () => p.x);
show("sum", () => p.sum());
show("typeof sum", () => typeof p.sum());
copy(q, p, "x");
show("copied", () => q.x);
show("sum of the copy", () => q.sum());
put(p, "x", p.sum);
show("a function in x", () => typeof p.x);
set(p, "x", 4);
show("honest again", () => p.sum());

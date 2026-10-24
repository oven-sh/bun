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

function speak(d: Dog): string {
  return d.bark();
}

const rex = new Dog("rex");
const fido = new Dog("fido");

let letters = 0;
for (let i = 0; i < 2000; i++) letters += speak(rex).length;
show("2000 honest calls", () => letters);

rex.bark = () => "an own arrow";
show("an own arrow: direct", () => rex.bark());
show("an own arrow: through the function", () => speak(rex));
show("the other dog", () => speak(fido));
show("own bark", () => Object.hasOwn(rex, "bark"));
show("keys", () => Object.keys(rex).join());

rex.bark = function (): string {
  return "an own function of " + this.name;
};
show("an own function", () => speak(rex));

const original = Dog.prototype.bark;
Dog.prototype.bark = function (): string {
  return "replaced for " + this.name;
};
show("replaced on the prototype: the other dog", () => speak(fido));
show("replaced on the prototype: a new dog", () => speak(new Dog("new")));
show("replaced on the prototype: the one with its own", () => speak(rex));

const loose: { bark?: () => string } = rex;
delete loose.bark;
show("the own one deleted", () => speak(rex));

Dog.prototype.bark = original;
show("put back", () => speak(fido));

class Puppy extends Dog {
  bark(): string {
    return "yip, " + super.bark();
  }
}
show("a subclass", () => speak(new Puppy("pup")));
Dog.prototype.bark = () => "an arrow on the prototype";
show("super sees the replacement", () => speak(new Puppy("pup")));
Dog.prototype.bark = original;

const borrowed: Dog = Object.assign(new Dog("borrowed"), { bark: new Cat("tom").purr });
show("another class's method as bark", () => speak(borrowed));

Object.defineProperty(fido, "bark", {
  get() {
    return () => "from a getter";
  },
});
show("a getter on the instance", () => speak(fido));
show("an untouched dog", () => speak(new Dog("last")));

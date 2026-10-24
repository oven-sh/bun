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

interface Extension {
  id: number;
  title: string;
  run(a: Animal): string;
  count(): number;
}

class DogPlugin {
  static id: number = 1;
  static title: string = "dogs";
  static calls: number = 0;
  static run(d: Dog): string {
    this.calls++;
    return d.tag + " " + d.legs;
  }
  static count(): number {
    return this.calls;
  }
}

class Inherits extends DogPlugin {
  static title: string = "inherits";
}

class WithGetters {
  static get id(): number {
    return 3;
  }
  static get title(): string {
    return "getters";
  }
  static run(a: Animal): string {
    return a.name;
  }
  static count(): number {
    return -1;
  }
}

const literal: Extension = {
  id: 4,
  title: "literal",
  run(a: Animal) {
    return "literal " + a.name;
  },
  count() {
    return 0;
  },
};

const plugins: Extension[] = [DogPlugin, Inherits, WithGetters, literal];
const rex = new Dog("rex");
const tom = new Cat("tom");

function describe(p: Extension): string {
  return p.id + " " + p.title + " " + typeof p;
}
function runWith(p: Extension, a: Animal): string {
  return p.run(a);
}

for (const p of plugins) {
  show(p.title + " describe", () => describe(p));
  show(p.title + " run a dog", () => runWith(p, rex));
  show(p.title + " run a cat", () => runWith(p, tom));
  show(p.title + " count", () => p.count());
  show(p.title + " keys", () => Object.keys(p).join());
  show(p.title + " run taken off", () => {
    const run = p.run;
    return run(rex);
  });
}

const one: Extension = DogPlugin;
one.id = 10;
one.title = "renamed";
show("a store through the object type", () => DogPlugin.id + " " + DogPlugin.title);
show("the subclass sees the id", () => Inherits.id);
const sub: Extension = Inherits;
sub.id = 20;
show("a store on the subclass", () => DogPlugin.id + " " + Inherits.id + " " + Object.hasOwn(Inherits, "id"));
show("a store where there is only a getter", () => {
  const getters: Extension = WithGetters;
  getters.id = 30;
  return WithGetters.id;
});

function named(o: { name: string; length: number }): string {
  return o.name + " " + o.length;
}
show("name and length of a class", () => named(DogPlugin));
show("name and length of a function", () => named(describe));
show("name and length of an object", () => named({ name: "object", length: 9 }));

function prototypeLegs(o: { prototype: Dog }): unknown {
  return o.prototype.legs;
}
show("legs of Dog.prototype", () => prototypeLegs(Dog));
show("bark of Dog.prototype", () => Dog.prototype.bark());

let total = 0;
for (let i = 0; i < 2000; i++) total += describe(literal).length;
show("2000 literals", () => total);
show("then a class", () => describe(DogPlugin));

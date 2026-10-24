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

interface Register {
  enter(a: Animal): void;
}

class DogRegister implements Register {
  latest: Dog = new Dog("nobody");
  all: Dog[] = [];
  byName = new Map<string, Dog>();
  legs: number[] = [];
  tags: string[] = [];
  totalLegs: number = 0;
  enter(d: Dog): void {
    this.latest = d;
    this.all.push(d);
    this.byName.set(d.name, d);
    this.legs.push(d.legs);
    this.tags.push(d.tag);
    this.totalLegs += d.legs;
  }
}

function legsOf(d: Dog): number {
  return d.legs;
}
function tagOf(d: Dog): string {
  return d.tag;
}
function firstOf(d: Dog): string {
  return d.owner.first;
}

const register = new DogRegister();
const door: Register = register;

for (let i = 0; i < 2000; i++) register.enter(new Dog("dog" + (i % 5)));
show("2000 dogs: total legs", () => register.totalLegs);
show("latest legs", () => legsOf(register.latest));

door.enter(new Cat("tom"));
show("total legs after a cat", () => register.totalLegs);
show("latest: legs", () => legsOf(register.latest));
show("latest: tag", () => tagOf(register.latest));
show("latest: owner", () => firstOf(register.latest));
show("latest: bark", () => register.latest.bark());
show("last of all: legs", () => legsOf(register.all[register.all.length - 1]));
show("by name: legs", () => {
  const found = register.byName.get("tom");
  return found === undefined ? "not found" : legsOf(found);
});
show("by name: tag", () => {
  const found = register.byName.get("tom");
  return found === undefined ? "not found" : tagOf(found);
});
show("last of legs", () => register.legs[register.legs.length - 1]);
show("last of legs plus one", () => register.legs[register.legs.length - 1] + 1);
show("last of tags", () => register.tags[register.tags.length - 1]);
show("last of tags: length", () => register.tags[register.tags.length - 1].length);
show("sum of the last three legs", () => {
  let sum = 0;
  for (let i = register.legs.length - 3; i < register.legs.length; i++) sum += register.legs[i];
  return sum;
});
show("join of the last three tags", () => register.tags.slice(-3).join());
show("is index 2000 in legs", () => 2000 in register.legs);

register.totalLegs = 0;
door.enter(new Spider("boris"));
show("total legs after a spider", () => register.totalLegs);
show("latest: legs", () => legsOf(register.latest));
show("latest: legs * 2", () => legsOf(register.latest) * 2);
show("latest: tag", () => tagOf(register.latest));
register.totalLegs = 0;
register.enter(new Dog("back"));
show("a dog again: total", () => register.totalLegs);
show("a dog again: latest", () => legsOf(register.latest) + " " + tagOf(register.latest) + " " + firstOf(register.latest));

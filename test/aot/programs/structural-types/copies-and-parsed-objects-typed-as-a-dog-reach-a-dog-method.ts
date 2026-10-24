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

class DogKeeper {
  legsOf(d: Dog): number {
    return d.legs;
  }
  legsPlusOne(d: Dog): number {
    return d.legs + 1;
  }
  tagOf(d: Dog): string {
    return d.tag;
  }
  tagLength(d: Dog): number {
    return d.tag.length;
  }
  ownerName(d: Dog): string {
    return d.owner.first;
  }
  speak(d: Dog): string {
    return d.bark();
  }
  shoe(d: Dog): void {
    d.legs = 6;
  }
  isDog(d: Dog): boolean {
    return d instanceof Dog;
  }
}

const keeper = new DogKeeper();
const rex = new Dog("rex");

const cloned: Dog = structuredClone(rex);
const assigned: Dog = Object.assign({}, rex);
const parsed: Dog = JSON.parse('{"name":"parsed","legs":4,"tag":"t","owner":{"first":"p"},"tricks":[]}');
const parsedWrong: Dog = JSON.parse('{"tricks":5,"owner":"nobody","tag":7,"legs":"four","name":null}');
const parsedEmpty: Dog = JSON.parse("{}");
const parsedNull: Dog = JSON.parse("null");
const parsedNumber: Dog = JSON.parse("12");
const parsedArray: Dog = JSON.parse("[1,2]");
const roundTrip: Dog = JSON.parse(JSON.stringify(rex));
const evaluated: Dog = eval("({ name: 'evaluated', legs: 2, get tag() { return 'from a getter'; }, owner: { first: 'e' }, tricks: [], bark() { return 'evaluated bark'; } })");
const created: Dog = Object.create(rex);
const reflected: Dog = Reflect.get({ pet: new Cat("reflected") }, "p" + "et");

const all: [string, Dog][] = [
  ["honest", rex],
  ["cloned", cloned],
  ["assigned", assigned],
  ["parsed", parsed],
  ["parsed wrong", parsedWrong],
  ["parsed empty", parsedEmpty],
  ["parsed null", parsedNull],
  ["parsed number", parsedNumber],
  ["parsed array", parsedArray],
  ["round trip", roundTrip],
  ["evaluated", evaluated],
  ["created", created],
  ["reflected", reflected],
  ["honest again", new Dog("fido")],
];

for (const [label, d] of all) {
  show(label + " legsOf", () => keeper.legsOf(d));
  show(label + " legsPlusOne", () => keeper.legsPlusOne(d));
  show(label + " tagOf", () => keeper.tagOf(d));
  show(label + " tagLength", () => keeper.tagLength(d));
  show(label + " ownerName", () => keeper.ownerName(d));
  show(label + " speak", () => keeper.speak(d));
  show(label + " isDog", () => keeper.isDog(d));
  show(label + " shoe", () => keeper.shoe(d));
  show(label + " legsOf after shoe", () => keeper.legsOf(d));
}
show("rex after the one made from it was shod", () => rex.legs);
show("direct: cloned", () => keeper.speak(cloned));
show("direct: cloned legs", () => keeper.legsPlusOne(cloned));
show("direct: parsed wrong legs", () => keeper.legsPlusOne(parsedWrong));
show("direct: reflected legs", () => keeper.legsPlusOne(reflected));

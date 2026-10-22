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

const makeCat: () => void = () => new Cat("tom");
const makeNumber: () => void = () => 42;
const makeString: () => void = () => "text";
const makeNothing: () => void = () => {};
const makeZero: () => void = () => 0;
function pushInto(list: number[]): (n: number) => void {
  return n => list.push(n);
}

class Holder {
  kept: void = undefined;
  list: void[] = [];
  keep(f: () => void): void {
    this.kept = f();
    this.list.push(this.kept);
  }
  pass(f: () => void): void {
    return f();
  }
}

function passOn(f: () => void): void {
  return f();
}
function isUndefined(f: () => void): boolean {
  return f() === undefined;
}
function sameTwice(f: () => void): boolean {
  const a = f();
  const b = f();
  return a === b;
}
function inTemplate(f: () => void): string {
  return `<${f()}>`;
}
function orDefault(f: () => void): unknown {
  return f() ?? "default";
}

const makers: [string, () => void][] = [
  ["cat", makeCat],
  ["number", makeNumber],
  ["string", makeString],
  ["nothing", makeNothing],
  ["zero", makeZero],
];

const holder = new Holder();
for (const [label, make] of makers) {
  show(label + " result", () => make());
  show(label + " typeof", () => typeof make());
  show(label + " passed on", () => passOn(make));
  show(label + " passed on by a method", () => holder.pass(make));
  show(label + " is undefined", () => isUndefined(make));
  show(label + " same twice", () => sameTwice(make));
  show(label + " in a template", () => inTemplate(make));
  show(label + " or default", () => orDefault(make));
  show(label + " kept", () => {
    holder.keep(make);
    return holder.kept;
  });
}
show("list of voids", () => holder.list.map(v => typeof v).join());
show("list of voids as JSON", () => JSON.stringify(holder.list));

const target: number[] = [];
const push = pushInto(target);
show("push returns the new length as void", () => push(5));
show("forEach with it", () => [1, 2].forEach(push));
show("map with it", () => [1, 2].map(push));
show("target", () => target);

const quiet: () => void = () => new Cat("hidden");
const loud: () => void | Dog = quiet;
show("void | Dog narrowed by a test for undefined", () => {
  const result = loud();
  if (result !== undefined) return typeof result.legs + " " + result.legs + " " + result.tag;
  return "undefined";
});
show("void | Dog: a method is called", () => {
  const result = loud();
  return result !== undefined ? result.bark() : "undefined";
});

async function later(f: () => Promise<void>): Promise<void> {
  const value = await f();
  console.log("awaited: " + text(value));
  return value;
}
const promised: () => Promise<void> = async () => {
  const cat: void = makeCat();
  return cat;
};
later(promised).then(value => console.log("then: " + text(value)));

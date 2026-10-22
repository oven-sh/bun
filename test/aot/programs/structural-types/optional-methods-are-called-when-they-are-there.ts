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

interface Hooks {
  before?(a: Animal): string;
  after?: (a: Animal) => string;
  count?: number;
  each?(a: Animal, index: number): number;
}

class NoHooks implements Hooks {}

class DogHooks implements Hooks {
  before(d: Dog): string {
    return "before " + d.tag + " " + d.legs;
  }
  after = (a: Animal): string => "after " + a.name;
  count = 2;
  each(d: Dog, index: number): number {
    return d.legs * index;
  }
}

class OnlyUndefined implements Hooks {
  before = undefined;
  after = undefined;
  count = undefined;
}

const literal: Hooks = {
  before(d: Dog) {
    return "literal " + d.bark();
  },
};

function run(hooks: Hooks, a: Animal): string {
  return [hooks.before?.(a), hooks.after?.(a), hooks.count, hooks.each?.(a, 3)].map(v => typeof v + ":" + v).join(" | ");
}
function has(hooks: Hooks): string {
  return ["before" in hooks, "after" in hooks, "count" in hooks, "each" in hooks].join() + " keys " + Object.keys(hooks).join("+");
}
function guarded(hooks: Hooks, a: Animal): string {
  if (hooks.before) return hooks.before(a);
  if (hooks.after !== undefined) return hooks.after(a);
  return "no hook";
}
function countPlusOne(hooks: Hooks): number {
  return (hooks.count ?? 0) + 1;
}

const all: [string, Hooks][] = [
  ["none", new NoHooks()],
  ["dog hooks", new DogHooks()],
  ["only undefined", new OnlyUndefined()],
  ["literal", literal],
  ["empty literal", {}],
];
const animals: Animal[] = [new Dog("rex"), new Cat("tom"), new Spider("boris")];

for (const [label, hooks] of all) {
  show(label + " has", () => has(hooks));
  show(label + " count + 1", () => countPlusOne(hooks));
  for (const animal of animals) {
    show(label + " run " + animal.constructor.name, () => run(hooks, animal));
    show(label + " guarded " + animal.constructor.name, () => guarded(hooks, animal));
  }
}

const late: Hooks = {};
show("before it is added", () => run(late, animals[0]));
late.before = (a: Animal) => "added " + a.name;
show("after it is added", () => run(late, animals[0]));
delete late.before;
show("after it is deleted", () => run(late, animals[0]));
late.before = undefined;
show("set to undefined", () => run(late, animals[0]) + " " + has(late));

let calls = 0;
const counting: Hooks = {
  get before() {
    calls++;
    return calls % 2 === 1 ? (a: Animal) => "odd " + a.name : undefined;
  },
};
show("a getter that changes its mind: optional call", () => counting.before?.(animals[0]));
show("a getter that changes its mind: optional call", () => counting.before?.(animals[0]));
show("a getter that changes its mind: test, then call", () => guarded(counting, animals[0]));
show("reads", () => calls);

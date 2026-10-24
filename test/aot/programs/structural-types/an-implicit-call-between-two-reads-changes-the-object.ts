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

let hook: () => void = () => {};

class Trigger {
  get touched(): number {
    hook();
    return 0;
  }
  set stored(value: number) {
    hook();
  }
  valueOf(): number {
    hook();
    return 0;
  }
  toString(): string {
    hook();
    return "";
  }
  toJSON(): number {
    hook();
    return 0;
  }
  *[Symbol.iterator](): Generator<number> {
    hook();
    yield 0;
  }
  static [Symbol.hasInstance](value: unknown): boolean {
    hook();
    return false;
  }
}
const trigger = new Trigger();
const trapped: { x?: number } = new Proxy({}, {
  has() {
    hook();
    return false;
  },
  get() {
    hook();
    return undefined;
  },
});

function pair(before: unknown, after: unknown): string {
  return typeof before + " " + String(before) + " -> " + typeof after + " " + String(after);
}

const ways: [string, (d: Dog) => string][] = [
  ["getter", d => { const a = d.legs; trigger.touched; return pair(a, d.legs); }],
  ["setter", d => { const a = d.legs; trigger.stored = 1; return pair(a, d.legs); }],
  ["unary plus", d => { const a = d.legs; +trigger; return pair(a, d.legs); }],
  ["template", d => { const a = d.legs; `${trigger}`; return pair(a, d.legs); }],
  ["concatenation", d => { const a = d.legs; const s = "" + trigger; return pair(a, d.legs) + s; }],
  ["String()", d => { const a = d.legs; String(trigger); return pair(a, d.legs); }],
  ["JSON", d => { const a = d.legs; JSON.stringify(trigger); return pair(a, d.legs); }],
  ["spread", d => { const a = d.legs; [...trigger]; return pair(a, d.legs); }],
  ["for-of", d => { const a = d.legs; for (const n of trigger) if (n > 0) break; return pair(a, d.legs); }],
  ["destructuring", d => { const a = d.legs; const [n] = trigger; return pair(a, d.legs) + (n > 0 ? "!" : ""); }],
  ["instanceof", d => { const a = d.legs; const is = d instanceof Trigger; return pair(a, d.legs) + (is ? "!" : ""); }],
  ["in a proxy", d => { const a = d.legs; const has = "x" in trapped; return pair(a, d.legs) + (has ? "!" : ""); }],
  ["read of a proxy", d => { const a = d.legs; const x = trapped.x; return pair(a, d.legs) + (x ?? ""); }],
  ["sort comparator", d => { const a = d.legs; [2, 1].sort((x, y) => (hook(), x - y)); return pair(a, d.legs); }],
  ["array join", d => { const a = d.legs; [trigger].join(); return pair(a, d.legs); }],
  ["as a key", d => { const a = d.legs; const o: Record<string, number> = {}; o[`${trigger}`] = 1; return pair(a, d.legs); }],
  ["in one expression", d => String(d.legs + trigger.touched + d.legs)],
  ["in one expression with a method", d => d.bark() + trigger + d.bark()],
];

const changes: [string, (d: Dog) => void][] = [
  ["nothing", () => {}],
  ["a number", d => { d.legs = 7; }],
  ["a string", d => { const wide: { legs: number | string } = d; wide.legs = "seven"; }],
  ["deleted", d => { const loose: { legs?: number } = d; delete loose.legs; }],
  ["a getter", d => { Object.defineProperty(d, "legs", { get: () => 70, configurable: true }); }],
  ["another prototype", d => { Object.setPrototypeOf(d, Cat.prototype); }],
  ["an own bark", d => { d.bark = () => "own"; }],
];

for (const [way, run] of ways) {
  for (const [change, mutate] of changes) {
    show(way + ", " + change, () => {
      const d = new Dog("rex");
      for (let i = 0; i < 50; i++) run(d);
      hook = () => mutate(d);
      try {
        return run(d);
      } finally {
        hook = () => {};
      }
    });
  }
}

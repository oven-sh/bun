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

class Person {
  first: string = "ann";
}

class Base {
  low: number = 1;
  lowText: string = "low";
}

class Derived extends Base {
  high: number = 2;
  label: string = "derived";
  owner: Person = new Person();
  #hidden: number = 3;
  sum(): number {
    return this.low + this.high;
  }
  title(): string {
    return this.label.toUpperCase();
  }
  ownerName(): string {
    return this.owner.first;
  }
  hidden(): number {
    return this.#hidden;
  }
}

function all(label: string, d: Derived): void {
  show(label + " low", () => d.low);
  show(label + " high", () => d.high);
  show(label + " label", () => d.label);
  show(label + " owner", () => d.owner);
  show(label + " sum", () => d.sum());
  show(label + " title", () => d.title());
  show(label + " ownerName", () => d.ownerName());
  show(label + " hidden", () => d.hidden());
  show(label + " instanceof Derived", () => d instanceof Derived);
  show(label + " keys", () => Object.keys(d).join());
}

const honest = new Derived();
const bare: Derived = Object.create(Derived.prototype);
const constructed = Reflect.construct(Base, [], Derived);
const halfway: Derived = constructed instanceof Derived ? constructed : honest;
const relinked: Derived = Object.setPrototypeOf({ low: 10, lowText: "x" }, Derived.prototype);
const assigned: Derived = Object.assign(Object.create(Derived.prototype), { high: "text", low: 1 });

all("honest", honest);
all("bare", bare);
all("halfway", halfway);
all("relinked", relinked);
all("assigned", assigned);
all("honest again", honest);

function highOf(d: Derived): number {
  return d.high;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += highOf(honest);
show("2000 honest reads", () => sum);
show("bare", () => highOf(bare));
show("halfway", () => highOf(halfway));
show("assigned", () => highOf(assigned));
show("honest", () => highOf(honest));

bare.high = 7;
show("bare after a store", () => bare.sum());
show("bare keys", () => Object.keys(bare).join());
bare.low = 1;
show("bare after two stores", () => bare.sum());

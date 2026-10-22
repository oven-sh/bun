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

const early: string[] = [];

function note(label: string, run: () => unknown): void {
  try {
    early.push(label + ": " + text(run()));
  } catch (error) {
    early.push(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Base {
  constructor() {
    this.init();
  }
  init(): void {}
}

class Derived extends Base {
  count: number = 5;
  ratio: number = 0.5;
  label: string = "set";
  owner: Person = new Person();
  list: number[] = [1, 2, 3];
  action: () => number = () => 7;
  flag: boolean = true;
  init(): void {
    note("count", () => this.count);
    note("count + 1", () => this.count + 1);
    note("count | 0", () => this.count | 0);
    note("count === undefined", () => this.count === undefined);
    note("ratio", () => this.ratio);
    note("ratio * 2", () => this.ratio * 2);
    note("label", () => this.label);
    note("label + '!'", () => this.label + "!");
    note("label.length", () => this.label.length);
    note("owner", () => this.owner);
    note("owner.first", () => this.owner.first);
    note("list", () => this.list);
    note("list.length", () => this.list.length);
    note("list[0]", () => this.list[0]);
    note("action", () => this.action);
    note("action()", () => this.action());
    note("flag", () => this.flag);
    note("flag ? :", () => (this.flag ? "yes" : "no"));
    note("keys", () => Object.keys(this).join());
    note("count in this", () => "count" in this);
    note("instanceof", () => this instanceof Derived);
  }
}

const made = new Derived();
for (const entry of early) console.log("early " + entry);
early.length = 0;
made.init();
for (const entry of early) console.log("late " + entry);

class Summing extends Base {
  a: number = 1;
  b: number = 2;
  seen: number = -1;
  init(): void {
    this.seen = this.a + this.b;
  }
}
const summing = new Summing();
show("a store made early is overwritten by the initializer", () => summing.seen);
summing.init();
show("the same store made late", () => summing.seen);

let results = "";
for (let i = 0; i < 3; i++) {
  const s = new Summing();
  results += s.seen + ",";
  s.init();
  results += s.seen + ";";
}
show("three more", () => results);

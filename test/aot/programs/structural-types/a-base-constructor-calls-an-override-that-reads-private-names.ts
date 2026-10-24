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
  #count: number = 5;
  #label: string = "set";
  #list: number[] = [1];
  static #made: number = 0;
  #twice(): number {
    return this.#count * 2;
  }
  get #half(): number {
    return this.#count / 2;
  }
  init(): void {
    note("#count", () => this.#count);
    note("#label", () => this.#label);
    note("#list", () => this.#list);
    note("#count = 1", () => (this.#count = 1));
    note("#count++", () => this.#count++);
    note("#count in this", () => #count in this);
    note("#twice in this", () => #twice in this);
    note("#twice()", () => this.#twice());
    note("#half", () => this.#half);
    note("static #made", () => Derived.#made++);
  }
  static has(o: object): boolean {
    return #count in o;
  }
  static read(o: Derived): number {
    return o.#count;
  }
}

const made = new Derived();
for (const entry of early) console.log("early " + entry);
early.length = 0;
made.init();
for (const entry of early) console.log("late " + entry);

show("has: an instance", () => Derived.has(made));
show("has: a plain object", () => Derived.has({}));
show("has: made from the prototype", () => Derived.has(Object.create(Derived.prototype)));
show("read: an instance", () => Derived.read(made));
show("read: made from the prototype", () => Derived.read(Object.create(Derived.prototype)));

let kept: Leaky | undefined;
class Leaky {
  #secret: number;
  constructor(fail: boolean) {
    kept = this;
    if (fail) throw new RangeError("failed");
    this.#secret = 3;
  }
  reveal(): number {
    return this.#secret;
  }
}
show("a constructor that throws", () => new Leaky(true));
show("what was kept", () => kept?.reveal());
show("a constructor that does not", () => new Leaky(false).reveal());

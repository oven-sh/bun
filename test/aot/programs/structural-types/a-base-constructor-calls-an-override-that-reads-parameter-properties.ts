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

abstract class Base {
  total: number;
  constructor() {
    this.total = this.measure();
  }
  abstract measure(): number;
}

class Box extends Base {
  constructor(
    public width: number,
    public readonly height: number,
    private title: string,
    protected owner: Person,
    public tags: string[],
  ) {
    super();
  }
  measure(): number {
    note("width", () => this.width);
    note("height", () => this.height);
    note("title", () => this.title);
    note("title.length", () => this.title.length);
    note("owner", () => this.owner);
    note("owner.first", () => this.owner.first);
    note("tags", () => this.tags);
    note("tags.length", () => this.tags.length);
    note("keys", () => Object.keys(this).join());
    return this.width * this.height;
  }
}

class Assigned extends Base {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    super();
    this.width = width;
    this.height = height;
  }
  measure(): number {
    note("assigned width", () => this.width);
    note("assigned own width", () => Object.hasOwn(this, "width"));
    return this.width + this.height;
  }
}

const box = new Box(2, 3, "box", new Person(), ["a"]);
for (const entry of early) console.log("early " + entry);
early.length = 0;
show("total computed early", () => box.total);
show("typeof total", () => typeof box.total);
show("total + 1", () => box.total + 1);
show("measure now", () => box.measure());
for (const entry of early) console.log("late " + entry);
early.length = 0;
show("keys", () => Object.keys(box).join());

const assigned = new Assigned(4, 5);
for (const entry of early) console.log("early " + entry);
show("assigned total", () => assigned.total);
show("assigned measure now", () => assigned.measure());
show("assigned keys", () => Object.keys(assigned).join());

function totalOf(b: Base): number {
  return b.total;
}
let sum = 0;
for (let i = 0; i < 100; i++) sum += totalOf(new Box(1, 1, "t", new Person(), []));
show("100 totals added", () => sum);

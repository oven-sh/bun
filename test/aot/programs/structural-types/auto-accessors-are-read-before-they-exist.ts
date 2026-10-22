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

class Gauge extends Base {
  accessor level: number = 5;
  accessor unit: string = "bar";
  accessor marks: number[] = [1, 2];
  plain: number = 1;
  static accessor made: number = 0;
  init(): void {
    note("level", () => this.level);
    note("level = 1", () => (this.level = 1));
    note("unit", () => this.unit);
    note("marks", () => this.marks);
    note("plain", () => this.plain);
    note("level in this", () => "level" in this);
    note("own level", () => Object.hasOwn(this, "level"));
    note("static made", () => Gauge.made++);
  }
}

const gauge = new Gauge();
for (const entry of early) console.log("early " + entry);
early.length = 0;
gauge.init();
for (const entry of early) console.log("late " + entry);

show("keys", () => Object.keys(gauge).join());
show("JSON", () => JSON.stringify(gauge));
show("names on the prototype", () => Object.getOwnPropertyNames(Gauge.prototype).join());

function levelOf(o: { level: number }): number {
  return o.level;
}
function setLevel(o: { level: number }, n: number): void {
  o.level = n;
}
show("as a plain property", () => levelOf(gauge));
setLevel(gauge, 9);
show("after a store as a plain property", () => gauge.level);
show("a plain object at the same functions", () => {
  const o = { level: 2 };
  setLevel(o, 3);
  return levelOf(o);
});
show("made from the prototype", () => levelOf(Object.create(Gauge.prototype)));
show("the getter on another object", () => {
  const getter = Object.getOwnPropertyDescriptor(Gauge.prototype, "level")?.get;
  return getter?.call({ level: 1 });
});

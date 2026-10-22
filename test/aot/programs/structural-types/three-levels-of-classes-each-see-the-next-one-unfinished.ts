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

const log: string[] = [];

function state(o: object): string {
  return Object.keys(o).join("+") || "nothing";
}

class Bottom {
  a: number = 1;
  constructor() {
    log.push("Bottom constructor: " + state(this) + " | " + this.describe());
  }
  describe(): string {
    return "a=" + this.a;
  }
}

class Middle extends Bottom {
  b: number = this.a + 1;
  seenByMiddle: string = this.describe();
  constructor() {
    super();
    log.push("Middle constructor: " + state(this) + " | " + this.describe());
  }
  describe(): string {
    return super.describe() + " b=" + this.b;
  }
}

class Top extends Middle {
  c: number = this.b + 1;
  label: string = "top";
  constructor() {
    super();
    log.push("Top constructor: " + state(this) + " | " + this.describe());
  }
  describe(): string {
    return super.describe() + " c=" + this.c + " label=" + this.label + " sum=" + (this.a + this.b + this.c);
  }
}

const highest = new Top();
for (const entry of log.splice(0)) console.log(entry);
show("seenByMiddle", () => highest.seenByMiddle);
show("describe", () => highest.describe());
show("keys", () => Object.keys(highest).join());

new Middle();
for (const entry of log.splice(0)) console.log(entry);

const kept: Fails[] = [];
function keep(o: Fails): number {
  kept.push(o);
  return 1;
}
function fail(really: boolean): number {
  if (really) throw new RangeError("an initializer failed");
  return 2;
}
class Fails {
  static really: boolean = true;
  a: number = keep(this);
  b: number = fail(Fails.really);
  c: number = 3;
  d: string = "d";
  sum(): number {
    return this.a + this.b + this.c;
  }
}
show("an initializer throws", () => new Fails());
show("what was kept: a", () => kept[0].a);
show("what was kept: b", () => kept[0].b);
show("what was kept: c", () => kept[0].c);
show("what was kept: d", () => kept[0].d);
show("what was kept: d.length", () => kept[0].d.length);
show("what was kept: sum", () => kept[0].sum());
show("what was kept: keys", () => Object.keys(kept[0]).join());
Fails.really = false;
show("it does not throw", () => new Fails().sum());
show("both sums", () => kept.map(f => f.sum()).join());

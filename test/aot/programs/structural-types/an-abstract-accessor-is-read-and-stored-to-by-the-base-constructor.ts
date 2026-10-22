function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
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

abstract class Sensor {
  abstract get level(): number;
  abstract set level(value: number);
  abstract get unit(): string;
  first: number;
  unitAtStart: string;
  constructor() {
    this.first = this.levelNow();
    this.unitAtStart = this.unitNow();
    this.setLevel(5);
  }
  levelNow(): number {
    return this.level;
  }
  unitNow(): string {
    return this.unit;
  }
  setLevel(value: number): void {
    this.level = value;
  }
  raised(): number {
    return this.level + 1;
  }
}

class WithAccessors extends Sensor {
  get level(): number {
    log.push("get");
    return 10;
  }
  set level(value: number) {
    log.push("set " + value);
  }
  get unit(): string {
    return "volt";
  }
}

class WithBacking extends Sensor {
  held: number = 1;
  get level(): number {
    return this.held;
  }
  set level(value: number) {
    this.held = value;
  }
  get unit(): string {
    return "unit " + this.held;
  }
}

class WithFields extends Sensor {
  level: number = 2;
  unit: string = "field";
}

function firstOf(sensor: Sensor): number {
  return sensor.first;
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += firstOf(new WithAccessors());
log.length = 0;
show("2000 with accessors", () => sum);

const accessors = new WithAccessors();
show("accessors: what ran", () => log.join());
show("accessors", () => [accessors.first, accessors.unitAtStart, accessors.raised(), Object.keys(accessors)]);

const backing = new WithBacking();
show("a field behind the accessor: first", () => [backing.first, typeof backing.first, firstOf(backing) + 1]);
show("a field behind the accessor: the unit at the start", () => backing.unitAtStart);
show("a field behind the accessor: the early store is overwritten", () => [backing.held, backing.level, backing.raised()]);
show("a field behind the accessor: keys", () => Object.keys(backing));

const fields = new WithFields();
show("fields: first", () => [fields.first, typeof fields.first, firstOf(fields) + 1]);
show("fields: the unit at the start", () => fields.unitAtStart);
show("fields: the early store is overwritten", () => [fields.level, fields.raised()]);
show("fields: keys", () => Object.keys(fields));
show("fields: JSON", () => JSON.stringify(fields));
show("three in a row", () => [new WithAccessors(), new WithFields(), new WithBacking()].map(firstOf));

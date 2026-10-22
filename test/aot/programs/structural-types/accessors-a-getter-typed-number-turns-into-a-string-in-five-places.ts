function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Gauge {
  raw: number | string = 1;
  turnsAfter: number;
  reads = 0;
  constructor(turnsAfter: number) {
    this.turnsAfter = turnsAfter;
  }
  tick(): void {
    if (++this.reads > this.turnsAfter) this.raw = "text";
  }
  get level(): number {
    if (typeof this.raw === "number") {
      this.tick();
      return this.raw;
    }
    return -1;
  }
}

interface Leveled {
  readonly level: number;
}

function half(n: number): number {
  return n / 2;
}

function inAParameter(g: Leveled): unknown {
  return [g.level, g.level + 1, half(g.level)];
}

function inALocal(turnsAfter: number): unknown {
  const g = new Gauge(turnsAfter);
  const level = g.level;
  return [level, level + 1, level * 2, half(level)];
}

class Panel {
  gauge: Gauge;
  last = 0;
  constructor(turnsAfter: number) {
    this.gauge = new Gauge(turnsAfter);
  }
  inAField(): unknown {
    this.last = this.gauge.level;
    return [this.last, this.last + 1, half(this.last)];
  }
}

function inAnElement(gauges: Leveled[]): unknown {
  const levels: number[] = [];
  for (const g of gauges) levels.push(g.level);
  let sum = 0;
  for (const n of levels) sum += n;
  return [levels, sum];
}

function inACapturedVariable(turnsAfter: number): unknown {
  const g = new Gauge(turnsAfter);
  let level = 0;
  const read = (): void => {
    level = g.level;
  };
  read();
  return [level, level + 1, half(level)];
}

const never = 1e9;

function round(label: string, turnsAfter: number): void {
  attempt(label + " in a parameter", () => inAParameter(new Gauge(turnsAfter)));
  attempt(label + " in a local", () => inALocal(turnsAfter));
  attempt(label + " in a field", () => new Panel(turnsAfter).inAField());
  attempt(label + " in an element", () => inAnElement([new Gauge(never), new Gauge(turnsAfter), { level: 3 }]));
  attempt(label + " in a captured variable", () => inACapturedVariable(turnsAfter));
}

round("steady", never);
let sum = 0;
const longLived = new Gauge(2000);
for (let i = 0; i < 2000; i++) sum += longLived.level;
console.log("2000 honest reads: " + sum);
attempt("read 2001 at the same getter", () => {
  const level = longLived.level;
  return [level, level + 1, half(level)];
});
attempt("read 2002", () => longLived.level);
round("turned at once", 0);
round("turned at the second read", 1);
round("steady again", never);

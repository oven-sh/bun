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

interface Meter {
  extra: number;
  note: string;
}
class Meter {
  own: number;
  constructor(own: number, extra: number, note: string) {
    this.own = own;
    this.extra = extra;
    this.note = note;
  }
  plusExtra(): number {
    return this.own + this.extra;
  }
  heading(): string {
    return this.note + "!";
  }
}

function extraOf(meter: Meter): number {
  return meter.extra;
}

function total(meters: Meter[]): number {
  let sum = 0;
  for (const meter of meters) sum += meter.extra;
  return sum;
}

const meter = new Meter(1, 2, "two");
show("read", () => [meter.extra, typeof meter.extra, meter.note]);
show("plus one", () => meter.extra + 1);
show("times two", () => meter.extra * 2);
show("to a whole number", () => meter.extra | 0);
show("toFixed", () => meter.extra.toFixed(1));
show("the length of the text", () => meter.note.length);
show("in methods", () => [meter.plusExtra(), meter.heading()]);
show("through a function", () => extraOf(meter));
show("in", () => "extra" in meter);
show("keys", () => Object.keys(meter));
show("JSON", () => JSON.stringify(meter));
show("spread", () => ({ ...meter }));

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const made = new Meter(i, i + 0.5, "n");
  sum += extraOf(made) + made.plusExtra() + made.heading().length;
}
show("2000 more", () => sum);
show("a list of three", () => total([new Meter(1, 1, "a"), new Meter(2, 2, "b"), new Meter(3, 3.5, "c")]));

meter.extra = 4;
meter.extra++;
meter.extra += 0.5;
show("after stores", () => [meter.extra, meter.plusExtra(), Object.keys(meter)]);

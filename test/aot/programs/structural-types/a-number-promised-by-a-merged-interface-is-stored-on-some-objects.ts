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
}
class Meter {
  own: number;
  constructor(own: number) {
    this.own = own;
  }
  plusExtra(): number {
    return this.own + this.extra;
  }
}

function filled(own: number, extra: number): Meter {
  const meter = new Meter(own);
  meter.extra = extra;
  return meter;
}

function extraOf(meter: Meter): number {
  return meter.extra;
}

function total(meters: Meter[]): number {
  let sum = 0;
  for (const meter of meters) sum += meter.extra;
  return sum;
}

show("the first call gets one without it", () => extraOf(new Meter(1)));
show("then one with it", () => extraOf(filled(1, 2)));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += extraOf(filled(i, i)) + filled(i, 1).plusExtra();
show("2000 with it", () => sum);
show("one without it", () => extraOf(new Meter(5)));
show("its method", () => new Meter(5).plusExtra());
show("one with it again", () => extraOf(filled(1, 2.5)));

show("a list of three, the second without", () => total([filled(1, 1), new Meter(2), filled(3, 3)]));
show("each of them", () => [filled(1, 1), new Meter(2), filled(3, 3)].map(extraOf));
show("keys with", () => Object.keys(filled(1, 2)));
show("keys without", () => Object.keys(new Meter(1)));
show("JSON of both", () => JSON.stringify([filled(1, 2), new Meter(1)]));

const late = new Meter(1);
show("before the store", () => [late.extra, "extra" in late]);
late.extra = 4;
show("after the store", () => [late.extra, "extra" in late, late.plusExtra()]);
late.extra++;
show("after ++", () => late.extra);
late.extra += 0.5;
show("after += 0.5", () => late.extra);
show("keys", () => Object.keys(late));

const counted = new Meter(1);
show("++ where there is nothing", () => counted.extra++);
show("after it", () => [counted.extra, Object.keys(counted)]);

const added = new Meter(1);
show("+= where there is nothing", () => (added.extra += 2));
show("after it", () => [added.extra, JSON.stringify(added)]);

const kept = new Meter(1);
show("??= where there is nothing", () => (kept.extra ??= 8));
show("after it", () => [kept.extra, Object.keys(kept)]);

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
  own: number = 1;
  plusExtra(): number {
    return this.own + this.extra;
  }
}

function twice(n: number): number {
  return n * 2;
}

function extraOf(meter: Meter): number {
  return meter.extra;
}

const meter = new Meter();
show("read", () => meter.extra);
show("typeof", () => typeof meter.extra);
show("plus one", () => meter.extra + 1);
show("times two", () => meter.extra * 2);
show("negated", () => -meter.extra);
show("to a whole number", () => meter.extra | 0);
show("unsigned", () => meter.extra >>> 0);
show("less than one", () => meter.extra < 1);
show("equals zero", () => meter.extra === 0);
show("equals itself", () => meter.extra === meter.extra);
show("equals undefined", () => meter.extra === undefined);
show("as a condition", () => (meter.extra ? "yes" : "no"));
show("or seven", () => meter.extra ?? 7);
show("in a template", () => `${meter.extra}`);
show("after a string", () => "n" + meter.extra);
show("Math.max", () => Math.max(meter.extra, 1));
show("Math.floor", () => Math.floor(meter.extra));
show("Number.isNaN", () => Number.isNaN(meter.extra));
show("Object.is with zero", () => Object.is(meter.extra, 0));
show("toFixed", () => meter.extra.toFixed(1));
show("in a method", () => meter.plusExtra());
show("through a function", () => extraOf(meter));
show("given to a typed function", () => twice(meter.extra));
show("a typed local", () => {
  const n: number = meter.extra;
  return n;
});
show("a typed element", () => {
  const list: number[] = [meter.extra, 1];
  return list;
});
show("added up", () => {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += meter.extra;
  return sum;
});
show("as an index", () => [10, 20][meter.extra]);
show("in", () => "extra" in meter);
show("own", () => Object.hasOwn(meter, "extra"));
show("keys", () => Object.keys(meter));
show("JSON", () => JSON.stringify(meter));
show("spread", () => ({ ...meter }));
show("taken apart", () => {
  const { extra, own } = meter;
  return [extra, own];
});
show("taken apart with a default", () => {
  const { extra = 9 } = meter;
  return extra;
});

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

interface Gauge {
  get level(): number;
  set level(value: number);
  get label(): string;
}
class Gauge {
  id: number = 1;
  raised(): number {
    return this.level + 1;
  }
}

function levelOf(gauge: Gauge): number {
  return gauge.level;
}

const gauge = new Gauge();
show("read", () => gauge.level);
show("typeof", () => typeof gauge.level);
show("plus one", () => gauge.level + 1);
show("in a method", () => gauge.raised());
show("through a function", () => levelOf(gauge));
show("the one with only a getter", () => gauge.label);
show("its length", () => gauge.label.length);
show("in", () => "level" in gauge);
show("on the prototype", () => Object.getOwnPropertyDescriptor(Gauge.prototype, "level"));
show("names of the prototype", () => Object.getOwnPropertyNames(Gauge.prototype));
show("keys", () => Object.keys(gauge));

gauge.level = 5;
show("after a store: read", () => gauge.level);
show("after a store: in a method", () => gauge.raised());
show("after a store: keys", () => Object.keys(gauge));
show("after a store: what it is", () => Object.getOwnPropertyDescriptor(gauge, "level"));
show("after a store: another instance", () => levelOf(new Gauge()));

const seen: string[] = [];
Object.defineProperty(Gauge.prototype, "level", {
  get(this: Gauge): number {
    seen.push("get");
    return this.id * 10;
  },
  set(this: Gauge, value: number) {
    seen.push("set " + value);
    this.id = value;
  },
  configurable: true,
});
const fresh = new Gauge();
show("after it is written: read", () => levelOf(fresh));
fresh.level = 7;
show("after it is written: stored and read", () => [levelOf(fresh), fresh.raised(), Object.keys(fresh)]);
show("after it is written: the one with its own value", () => [levelOf(gauge), Object.keys(gauge)]);
show("what ran", () => seen.join());

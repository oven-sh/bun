function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

class Meter {
  value = 1;
  name = "m";
  get twice(): number {
    return this.value * 2;
  }
  next(): number {
    return this.value + 1;
  }
}

attempt("a typed store", () => {
  const meter = new Meter();
  return [Reflect.set(meter, "value", 5), meter.value, meter.next()];
});
attempt("a store of a parsed value", () => {
  const meter = new Meter();
  return [Reflect.set(meter, "value", JSON.parse('"five"')), meter.value, typeof meter.value, meter.next(), meter.twice];
});
attempt("a store for another receiver", () => {
  const meter = new Meter();
  const other = { value: "other" };
  return [Reflect.set(meter, "value", 5, other), meter.value, other.value, typeof other.value];
});
attempt("a store to an accessor without a setter", () => {
  const meter = new Meter();
  const key: string = "twice";
  return [Reflect.set(meter, key, 5), meter.twice];
});
attempt("a store to a frozen object", () => {
  const meter = Object.freeze(new Meter());
  const open: Meter = meter;
  return [Reflect.set(open, "value", 5), open.value];
});
attempt("the value of a typed descriptor", () => {
  const meter = new Meter();
  const value = Reflect.getOwnPropertyDescriptor(meter, "value")?.value;
  return value === undefined ? "absent" : [value + 1, plusOne(value)];
});
attempt("the value of a typed descriptor after another kind was stored", () => {
  const meter = new Meter();
  Reflect.set(meter, "value", JSON.parse('"text"'));
  const value = Reflect.getOwnPropertyDescriptor(meter, "value")?.value;
  return value === undefined ? "absent" : [value, typeof value, value + 1, plusOne(value)];
});
attempt("the descriptor of what lives on the prototype", () => [Reflect.getOwnPropertyDescriptor(new Meter(), "twice"), Reflect.getOwnPropertyDescriptor(new Meter(), "next"), typeof Reflect.getOwnPropertyDescriptor(Meter.prototype, "twice")?.get]);
attempt("a getter taken from its descriptor", () => {
  const get = Reflect.getOwnPropertyDescriptor(Meter.prototype, "twice")?.get;
  return get === undefined ? "absent" : [get.call(new Meter()) + 1, get.call({ value: "ab" }), get.call({})];
});
attempt("has, delete and the keys", () => {
  const meter = new Meter();
  const before = [Reflect.has(meter, "value"), Reflect.has(meter, "twice"), Reflect.has(meter, "nothing"), Reflect.ownKeys(meter).join()];
  const deleted = Reflect.deleteProperty(meter, "value");
  return [before, deleted, Reflect.has(meter, "value"), meter.value, meter.next(), Reflect.ownKeys(meter).join()];
});
attempt("defined again as an accessor", () => {
  const meter = new Meter();
  let reads = 0;
  const done = Reflect.defineProperty(meter, "value", { get: () => ++reads, configurable: true });
  return [done, meter.value, meter.next(), Reflect.get(meter, "value") + 1, reads];
});

let warm = 0;
const hot = new Meter();
for (let i = 0; i < 2000; i++) {
  Reflect.set(hot, "value", i);
  warm += hot.next() + (Reflect.getOwnPropertyDescriptor(hot, "value")?.value ?? 0);
}
console.log("2000 rounds: " + warm);

export {};

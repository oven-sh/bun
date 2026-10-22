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

class Base {
  inherited = 1;
  shared(): string {
    return "shared";
  }
}

class Meter extends Base {
  value = 1;
  label: string | number = "l";
  optional?: number;
  readonly fixed = 4;
  static count = 0;
  get twice(): number {
    return this.value * 2;
  }
  set twice(n: number) {
    this.value = n / 2;
  }
  add(by: number): number {
    this.value += by;
    return this.value;
  }
  spoil(): void {
    Reflect.set(this, "value", "spoiled");
  }
}

const literal = { x: 1, y: "two", inner: { depth: 3 }, step: (n: number) => n + 1 };

function storeX(n: number): void {
  literal.x = n;
}

attempt("a member of a literal", () => [Reflect.get(literal, "x") + 1, Reflect.get(literal, "y").length, Reflect.get(literal, "inner").depth, Reflect.get(literal, "step")(1)]);
attempt("after a function stored to it", () => {
  storeX(5);
  return plusOne(Reflect.get(literal, "x"));
});
attempt("a field", () => {
  const meter = new Meter();
  const before = Reflect.get(meter, "value");
  meter.add(2);
  return [before + 1, Reflect.get(meter, "value") + 1, plusOne(Reflect.get(meter, "value"))];
});
attempt("an inherited field and a method", () => {
  const meter = new Meter();
  return [Reflect.get(meter, "inherited") + 1, Reflect.get(meter, "shared").call(meter), Reflect.get(meter, "add").call(meter, 1)];
});
attempt("an accessor", () => {
  const meter = new Meter();
  return [Reflect.get(meter, "twice") + 1, Reflect.get(meter, "twice", { value: 21 }), Reflect.get(meter, "twice", { value: "ab" })];
});
attempt("a union, an optional and a read-only member", () => {
  const meter = new Meter();
  const label = Reflect.get(meter, "label");
  const optional = Reflect.get(meter, "optional");
  return [typeof label === "string" ? label.length : label + 1, optional === undefined ? "absent" : optional + 1, Reflect.get(meter, "fixed") + 1];
});
attempt("a static member and the prototype", () => [Reflect.get(Meter, "count") + 1, typeof Reflect.get(Meter, "prototype").add, Reflect.get(Meter, "name"), Reflect.get(Meter, "length")]);
attempt("a field that holds another kind", () => {
  const meter = new Meter();
  meter.spoil();
  const value = Reflect.get(meter, "value");
  return [value, typeof value, value + 1, plusOne(value), meter.value + 1];
});
attempt("a field that was deleted", () => {
  const meter = new Meter();
  Reflect.deleteProperty(meter, "value");
  const value = Reflect.get(meter, "value");
  return [value, value + 1, plusOne(value)];
});
attempt("through a proxy", () => {
  const proxy = new Proxy(new Meter(), { get: (target, key) => (key === "value" ? "trapped" : Reflect.get(target, key)) });
  const value = Reflect.get(proxy, "value");
  return [value, value + 1, plusOne(value)];
});

let warm = 0;
const hot = new Meter();
for (let i = 0; i < 2000; i++) warm += Reflect.get(hot, "value") + Reflect.get(literal, "x") + Reflect.get(hot, "twice");
console.log("2000 rounds: " + warm);

export {};

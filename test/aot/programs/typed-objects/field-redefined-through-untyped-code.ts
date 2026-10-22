// A field of a typed object becomes an accessor, read-only or not enumerable through `any`, an untyped function, a computed name and Reflect. Every definition succeeds, and typed code reads what the property gives.
class Counter {
  count = 1;
  label = "c";
  bump(): number {
    return ++this.count;
  }
}
interface Row {
  id: number;
}
function makeRow(id: number): Row {
  return { id };
}
const untyped: any = {
  getter(target: any, key: string, value: unknown) {
    Object.defineProperty(target, key, { get: () => value, configurable: true });
  },
};
function attempt(name: string, run: () => unknown): void {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, "throws", (error as Error).name);
  }
}

attempt("a getter and a setter between two reads", () => {
  const counter = new Counter();
  const before = counter.count;
  const any: any = counter;
  Object.defineProperty(any, "count", { get: () => 50, set: () => {}, configurable: true });
  return [before, counter.count, counter.bump()].join(" ");
});
attempt("a getter on a string field", () => {
  const counter = new Counter();
  const any: any = counter;
  Object.defineProperty(any, "label", { get: () => "g", configurable: true });
  return counter.label;
});
attempt("read-only", () => {
  const counter = new Counter();
  const any: any = counter;
  Object.defineProperty(any, "count", { value: 7, writable: false, configurable: true, enumerable: true });
  return counter.count;
});
attempt("not enumerable", () => {
  const counter = new Counter();
  const any: any = counter;
  Object.defineProperty(any, "count", { enumerable: false });
  return Object.keys(counter).join() + " " + counter.count;
});
attempt("in an untyped function", () => {
  const counter = new Counter();
  untyped.getter(counter, "count", 50);
  return counter.count;
});
attempt("under a computed name", () => {
  const counter = new Counter();
  untyped.getter(counter, ["co", "unt"].join(""), 50);
  return counter.count;
});
attempt("Reflect.defineProperty", () => {
  const counter = new Counter();
  const any: any = counter;
  return Reflect.defineProperty(any, "count", { get: () => 50, configurable: true }) + " " + counter.count;
});
attempt("Object.defineProperties", () => {
  const counter = new Counter();
  const any: any = counter;
  Object.defineProperties(any, { count: { get: () => 50, configurable: true } });
  return counter.count;
});
attempt("a literal of an interface", () => {
  const row = makeRow(1);
  untyped.getter(row, "id", 50);
  return row.id;
});
attempt("the same attributes and another value", () => {
  const counter = new Counter();
  const any: any = counter;
  Object.defineProperty(any, "count", { value: 7, writable: true, configurable: true, enumerable: true });
  return counter.count + " " + counter.bump();
});

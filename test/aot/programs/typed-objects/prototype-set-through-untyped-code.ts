// The prototype of a typed object is replaced through `any`, an untyped function, Reflect and `__proto__`. Every change succeeds, and typed calls find the methods of the new prototype.
class Counter {
  count = 1;
  label = "c";
  note?: string;
  bump(): number {
    return ++this.count;
  }
}
interface Row {
  id: number;
  name?: string;
}
function makeRow(id: number): Row {
  return { id };
}
function attempt(name: string, run: () => unknown): void {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, "throws", (error as Error).name);
  }
}

const untyped: any = {
  reparent(target: any, prototype: object | null) {
    return Object.setPrototypeOf(target, prototype);
  },
};
const other = { bump() { return -1; }, extra: "inherited" };

attempt("another prototype between two calls", () => {
  const counter = new Counter();
  const before = counter.bump();
  const any: any = counter;
  Object.setPrototypeOf(any, other);
  return [before, counter.bump(), counter.count, counter instanceof Counter].join(" ");
});
attempt("in an untyped function", () => {
  const counter = new Counter();
  untyped.reparent(counter, other);
  return counter.bump() + " " + (counter as any).extra;
});
attempt("null", () => {
  const counter = new Counter();
  untyped.reparent(counter, null);
  return counter.count + " " + typeof counter.bump;
});
attempt("Reflect.setPrototypeOf", () => {
  const counter = new Counter();
  const any: any = counter;
  return Reflect.setPrototypeOf(any, other) + " " + counter.bump();
});
attempt("__proto__", () => {
  const counter = new Counter();
  const any: any = counter;
  any.__proto__ = other;
  return counter.bump();
});
attempt("a literal of an interface", () => {
  const row = makeRow(1);
  untyped.reparent(row, other);
  return row.id + " " + (row as any).extra;
});
attempt("the prototype it has already", () => {
  const counter = new Counter();
  untyped.reparent(counter, Counter.prototype);
  return counter.bump();
});

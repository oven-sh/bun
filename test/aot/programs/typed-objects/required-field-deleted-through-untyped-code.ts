// A required field of a typed object is deleted through `any`, an untyped function, a computed name and Reflect. Every delete succeeds, and a typed read afterwards gives undefined.
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
  remove(target: any, key: string) {
    return delete target[key];
  },
};

attempt("a required field between two reads", () => {
  const counter = new Counter();
  const before = counter.count;
  const any: any = counter;
  delete any.count;
  return [before, counter.count, "count" in counter].join(" ");
});
attempt("in an untyped function", () => {
  const counter = new Counter();
  return untyped.remove(counter, "count") + " " + counter.count + " " + Object.keys(counter).join();
});
attempt("under a computed name", () => {
  const counter = new Counter();
  return untyped.remove(counter, ["co", "unt"].join("")) + " " + counter.count;
});
attempt("a string field", () => {
  const counter = new Counter();
  return untyped.remove(counter, "label") + " " + counter.label;
});
attempt("Reflect.deleteProperty", () => {
  const counter = new Counter();
  const any: any = counter;
  return Reflect.deleteProperty(any, "count") + " " + counter.count;
});
attempt("deleted and stored again", () => {
  const counter = new Counter();
  untyped.remove(counter, "count");
  counter.count = 5;
  return counter.bump() + " " + Object.keys(counter).join();
});
attempt("a literal of an interface", () => {
  const row = makeRow(1);
  return untyped.remove(row, "id") + " " + row.id;
});
attempt("an optional field", () => {
  const counter = new Counter();
  counter.note = "n";
  return untyped.remove(counter, "note") + " " + counter.note;
});

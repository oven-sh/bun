function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Counter {
  count = 0;
  step = 1.5;
  seen: number[] = [];
  label = "counter";
  bump(): number {
    this.count += this.step;
    this.seen.push(this.count);
    return this.count;
  }
}

function childOf(parent: Counter): Counter {
  return Object.create(parent);
}

function read(counter: Counter): number {
  return counter.count + counter.step;
}

function bump(counter: Counter): number {
  return counter.bump();
}

function setStep(counter: Counter, step: number): number {
  counter.step = step;
  return counter.step;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Counter();
  warm += read(honest) + bump(honest) + setStep(honest, i);
}
console.log("after 2000 honest counters", warm);

attempt("reads go to the parent", () => {
  const parent = new Counter();
  const child = childOf(parent);
  parent.count = 10;
  return [read(child), child.label, Object.keys(child), Object.hasOwn(child, "count"), child instanceof Counter];
});
attempt("a store shadows", () => {
  const parent = new Counter();
  const child = childOf(parent);
  setStep(child, 3);
  return [child.step, parent.step, Object.keys(child)];
});
attempt("a method stores on the child and pushes on the parent", () => {
  const parent = new Counter();
  const child = childOf(parent);
  return [bump(child), bump(child), parent.count, child.count, parent.seen, child.seen === parent.seen, Object.keys(child)];
});
attempt("the parent changes after the child has shadowed", () => {
  const parent = new Counter();
  const child = childOf(parent);
  bump(child);
  parent.count = 100;
  parent.step = 50;
  return [child.count, child.step, read(child)];
});
attempt("deleting the shadow uncovers the parent", () => {
  const parent = new Counter();
  const child = childOf(parent);
  setStep(child, 3);
  Reflect.deleteProperty(child, "step");
  return [child.step, Object.keys(child)];
});
attempt("the parent loses a field", () => {
  const parent = new Counter();
  const child = childOf(parent);
  Reflect.deleteProperty(parent, "step");
  return [child.step, read(child), bump(child)];
});
attempt("a frozen parent stops the child's stores", () => {
  const child = childOf(Object.freeze(new Counter()));
  return setStep(child, 3);
});
attempt("a frozen parent stops the child's method", () => bump(childOf(Object.freeze(new Counter()))));
attempt("keys, JSON, spread and for-in", () => {
  const child = childOf(new Counter());
  const names: string[] = [];
  for (const name in child) names.push(name);
  return [Object.keys(child), JSON.stringify(child), Object.keys({ ...child }), names];
});
attempt("a grandchild", () => {
  const parent = new Counter();
  const grandchild = childOf(childOf(parent));
  bump(grandchild);
  return [grandchild.count, parent.count, Object.keys(grandchild)];
});
attempt("two children of one parent", () => {
  const parent = new Counter();
  const a = childOf(parent);
  const b = childOf(parent);
  bump(a);
  return [a.count, b.count, b.seen];
});
attempt("in the middle of a loop over honest counters", () => {
  const counters: Counter[] = [];
  for (let i = 0; i < 3000; i++) counters.push(i === 1500 ? childOf(new Counter()) : new Counter());
  let total = 0;
  for (const counter of counters) total += bump(counter) + read(counter);
  return [total, Object.keys(counters[1500])];
});
attempt("honest again", () => [read(new Counter()), bump(new Counter())]);

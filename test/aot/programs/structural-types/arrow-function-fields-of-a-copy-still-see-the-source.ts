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
  step = 2;
  bump = (): number => {
    this.count += this.step;
    return this.count;
  };
  read = (): number => this.count;
  method(): number {
    this.count += this.step;
    return this.count;
  }
}

function bump(counter: Counter): number {
  return counter.bump();
}

function read(counter: Counter): number {
  return counter.read();
}

function field(counter: Counter): number {
  return counter.count;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Counter();
  warm += bump(honest) + read(honest) + field(honest) + honest.method();
}
console.log("after 2000 honest counters", warm);

function withPrototype(source: Counter): Counter {
  return Object.assign(Object.create(Counter.prototype), source);
}
function child(source: Counter): Counter {
  return Object.create(source);
}

const makers: [string, (source: Counter) => Counter][] = [
  ["the counter itself", source => source],
  ["an assigned copy", source => Object.assign({}, source)],
  ["a copy with the prototype", withPrototype],
  ["a child", child],
  ["a proxy", source => new Proxy(source, {})],
  ["a proxy that logs nothing but answers 100 for count", source => new Proxy(source, { get: (target, key, receiver) => (key === "count" ? 100 : Reflect.get(target, key, receiver)) })],
];
for (const [name, make] of makers) {
  attempt(name + ": the arrow function bumps", () => {
    const source = new Counter();
    const made = make(source);
    return [bump(made), bump(made), field(made), read(made), field(source)];
  });
  attempt(name + ": a store to the copy's step", () => {
    const source = new Counter();
    const made = make(source);
    made.step = 10;
    return [bump(made), field(made), field(source), source.step];
  });
  attempt(name + ": the method bumps", () => {
    const source = new Counter();
    const made = make(source);
    return [made.method(), field(made), read(made), field(source)];
  });
  attempt(name + ": the functions are the same", () => {
    const source = new Counter();
    return [make(source).bump === source.bump, Object.hasOwn(make(source), "bump")];
  });
}
attempt("a clone refuses the functions", () => structuredClone(new Counter()));
attempt("text drops the functions", () => {
  const parsed: Counter = JSON.parse(JSON.stringify(new Counter()));
  return [Object.keys(parsed), typeof parsed.bump];
});
attempt("text drops the functions, called", () => {
  const parsed: Counter = JSON.parse(JSON.stringify(new Counter()));
  return bump(parsed);
});
attempt("an arrow function taken off and called", () => {
  const source = new Counter();
  const { bump: taken } = source;
  return [taken(), taken.call(new Counter()), field(source)];
});

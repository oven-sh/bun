function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

class Record2 {
  count: number;
  name: string;
  items: number[];
  owner: Dog;
  ready: boolean;
  run: () => number;

  next(): number {
    return this.count + 1;
  }
  bump(): number {
    return ++this.count;
  }
  title(): string {
    return this.name + "!";
  }
  width(): number {
    return this.name.length;
  }
  total(): number {
    let sum = 0;
    for (const n of this.items) sum += n;
    return sum;
  }
  add(n: number): number {
    return this.items.push(n);
  }
  legs(): number {
    return this.owner.legs;
  }
  state(): string {
    return this.ready ? "ready" : "waiting";
  }
  go(): number {
    return this.run() + 1;
  }
  fill(): this {
    this.count = 1;
    this.name = "ab";
    this.items = [1, 2];
    this.owner = new Dog();
    this.ready = true;
    this.run = () => 5;
    return this;
  }
}

attempt("honest", () => {
  const r = new Record2().fill();
  return [r.next(), r.bump(), r.title(), r.width(), r.total(), r.add(3), r.legs(), r.state(), r.go(), Object.keys(r)];
});
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const r = new Record2().fill();
  warm += r.next() + r.bump() + r.width() + r.total() + r.add(i) + r.legs() + r.go();
}
console.log("2000 honest rounds", warm);

attempt("keys of a new one", () => [Object.keys(new Record2()), "count" in new Record2(), JSON.stringify(new Record2())]);
attempt("count: next", () => new Record2().next());
attempt("count: bump", () => {
  const r = new Record2();
  return [r.bump(), r.count, r.bump()];
});
attempt("name: title", () => new Record2().title());
attempt("name: width", () => new Record2().width());
attempt("items: total", () => new Record2().total());
attempt("items: add", () => new Record2().add(1));
attempt("owner: legs", () => new Record2().legs());
attempt("ready: state", () => new Record2().state());
attempt("run: go", () => new Record2().go());
attempt("read from outside", () => {
  const r = new Record2();
  const n: number = r.count;
  const s: string = r.name;
  const b: boolean = r.ready;
  return [n, s, b, typeof n, n + 1, s + "!", !b, b === false];
});
attempt("half filled", () => {
  const r = new Record2();
  r.count = 1;
  r.items = [1];
  return [r.next(), r.total(), r.title(), Object.keys(r)];
});
attempt("filled in another order", () => {
  const r = new Record2();
  r.run = () => 1;
  r.ready = false;
  r.owner = new Dog();
  r.items = [];
  r.name = "z";
  r.count = 0;
  return [Object.keys(r), r.next(), r.title(), r.go()];
});
attempt("a subclass reads what the base never set", () => {
  class More extends Record2 {
    extra = this.count;
    twice(): number {
      return this.extra * 2;
    }
  }
  return [new More().extra, new More().twice()];
});
attempt("many in one list, some filled", () => {
  const list: Record2[] = [new Record2().fill(), new Record2(), new Record2().fill()];
  return list.map(r => r.next());
});

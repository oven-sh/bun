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

function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
    describe(): string {
      return this.tag + ":" + Object.keys(this).join();
    }
  };
}

function Counted(Base: new () => object) {
  return class extends Base {
    count = 0;
    #hidden = 5;
    static made = 0;
    constructor() {
      super();
      Counted.total++;
    }
    next(): number {
      return ++this.count + this.#hidden;
    }
    get twice(): number {
      return this.count * 2;
    }
  };
}
Counted.total = 0;

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class Name {
  first = "a";
  last = "b";
  middle = "c";
}

class Empty {}

class Wide {
  a = 1;
  b = 2;
  c = 3;
  d = 4;
  e = 5;
  f = 6;
}

class Child extends Point {
  z = 3;
}

const bases: [string, new () => object][] = [
  ["Point", Point],
  ["Name", Name],
  ["Empty", Empty],
  ["Wide", Wide],
  ["Child", Child],
  ["Array", Array],
  ["Map", Map],
  ["Error", Error],
  ["Object", Object],
  ["Date", Date],
];

for (const [name, Base] of bases) {
  attempt("Tagged " + name, () => {
    const made = new (Tagged(Base))();
    return [made.describe(), made.tag, JSON.stringify(Object.keys(made)), made instanceof Base];
  });
  attempt("Counted " + name, () => {
    const made = new (Counted(Base))();
    return [made.next(), made.next(), made.twice, Object.keys(made).join(), made instanceof Base];
  });
  attempt("Counted over Tagged " + name, () => {
    const made = new (Counted(Tagged(Base)))();
    return [made.next(), Object.keys(made).join(), made instanceof Base];
  });
}

attempt("again in the other order", () => [...bases].reverse().map(([, Base]) => new (Tagged(Base))().describe()));
attempt("two classes from one base are different classes", () => {
  const A = Tagged(Point);
  const B = Tagged(Point);
  return [A === B, new A() instanceof B, new A().describe(), new B().describe()];
});
attempt("one class, many instances", () => {
  const A = Tagged(Point);
  const list = [new A(), new A(), new A()];
  list[1].tag = "changed";
  return list.map(item => item.describe());
});
attempt("2000 classes over alternating bases", () => {
  let length = 0;
  for (let i = 0; i < 2000; i++) length += new (Tagged(bases[i % 5][1]))().describe().length;
  return length;
});
attempt("members of the base are still there", () => {
  const made = new (Tagged(Point))();
  const asPoint: object = made;
  return asPoint instanceof Point ? [asPoint.x, asPoint.y, asPoint.sum()] : "no point";
});
attempt("how often the constructors ran", () => Counted.total);

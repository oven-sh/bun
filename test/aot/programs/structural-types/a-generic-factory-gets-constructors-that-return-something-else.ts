function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

function create<T>(ctor: new () => T): T {
  return new ctor();
}

function createWith<T, A>(ctor: new (argument: A) => T, argument: A): T {
  return new ctor(argument);
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

const spare = { x: 10, y: 20, sum: () => 30, spare: true };

class ReturnsALiteral {
  x = 1;
  y = 2;
  constructor() {
    return spare;
  }
  sum(): number {
    return this.x + this.y;
  }
}

class ReturnsAPoint extends Point {
  z = 3;
  constructor() {
    super();
    return Object.assign(new Point(), { z: 4 });
  }
}

const cache: Singleton[] = [];
class Singleton {
  count = 0;
  constructor() {
    if (cache.length > 0) return cache[0];
    cache.push(this);
  }
}

const trapped = new Proxy(Point, {
  construct() {
    return { x: "from the trap", y: 0 };
  },
});

const bound = Point.bind(null);

function study<T extends object>(title: string, ctor: new () => T, use: (made: T) => unknown): void {
  attempt(title, () => {
    const made = create(ctor);
    return [made instanceof ctor, Object.keys(made), JSON.stringify(made), use(made)];
  });
}

let total = 0;
for (let i = 0; i < 2000; i++) total += create(Point).sum();
console.log("2000 honest rounds: " + total);

study("an ordinary class", Point, p => [p.sum(), p.x + 1]);
study("a constructor that returns a literal", ReturnsALiteral, p => [p.sum(), p.x + 1, p.y * 2]);
study("a subclass constructor that returns an instance of the base", ReturnsAPoint, p => [p.sum(), p.z + 1, p instanceof Point]);
study("a constructor that returns the first instance", Singleton, s => ++s.count);
study("the same once more", Singleton, s => ++s.count);
study("a construct trap", trapped, p => [typeof p.x, p.x + 1, typeof p.sum]);
study("a construct trap: the method", trapped, p => p.sum());
study("a bound class", bound, p => [p.sum(), p instanceof Point]);
study("Object", Object, o => typeof o);
study("Array", Array, a => a.length);
study("Map", Map, m => m.size);
study("String", String, s => [typeof s, s.length, s + "!"]);
study("Number", Number, n => [typeof n, n.valueOf() + 1]);
study("Boolean", Boolean, b => [typeof b, b ? "truthy" : "falsy", b.valueOf()]);
study("Function", Function, f => [typeof f, f.length]);
study("Error", Error, e => e.message.length);
study("an anonymous class", class {
  only = "here";
}, o => o.only.toUpperCase());
attempt("with an argument: Array and 3", () => createWith<number[], number>(Array, 3));
attempt("with an argument: Array and 3, summed", () => createWith<number[], number>(Array, 3).reduce((a, b) => a + b, 0));
attempt("with an argument: Array and 3, first + 1", () => createWith<number[], number>(Array, 3)[0] + 1);
attempt("with an argument: Array and -1", () => createWith<number[], number>(Array, -1));
attempt("with an argument: String and 5", () => createWith(String, 5).length);
attempt("with an argument: Set and a string", () => [...createWith<Set<string>, string>(Set, "aab")]);

export {};

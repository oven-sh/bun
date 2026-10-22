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

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class Person {
  name = "Ada";
  age = 36.5;
  greet(): string {
    return "hello " + this.name;
  }
}

class Basket {
  items: string[] = ["apple"];
  #weight = 3;
  add(item: string): number {
    return this.items.push(item);
  }
  weight(): number {
    return this.#weight;
  }
}

class Timer {
  ticks = 0;
  tick = (): number => ++this.ticks;
}

function withPrototype<T extends object>(value: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(value)), value);
}

function flat<T extends object>(value: T): T {
  return Object.assign({}, value);
}

function deep<T>(value: T): T {
  return structuredClone(value);
}

function text<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function wrapped<T extends object>(value: T): T {
  return new Proxy(value, {});
}

function same<T>(value: T): T {
  return value;
}

const copiers: [string, <T extends object>(value: T) => T][] = [
  ["the same object", same],
  ["a copy with the prototype", withPrototype],
  ["a flat copy", flat],
  ["a deep copy", deep],
  ["a copy through text", text],
  ["a proxy", wrapped],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += same(new Point()).sum() + same(new Person()).greet().length + same(new Basket()).add("pear") + same(new Basket()).weight() + same(new Timer()).tick();
console.log("after 2000 honest uses", warm);

for (const [name, copy] of copiers) {
  attempt(name + ": a point's fields", () => copy(new Point()).x + copy(new Point()).y);
  attempt(name + ": a point's method", () => copy(new Point()).sum());
  attempt(name + ": a person's fields", () => [copy(new Person()).name.length, copy(new Person()).age * 2]);
  attempt(name + ": a person's method", () => copy(new Person()).greet());
  attempt(name + ": a basket's list is shared", () => {
    const source = new Basket();
    const made = copy(source);
    made.items.push("pear");
    return [source.items.length, made.items === source.items];
  });
  attempt(name + ": a basket's method", () => copy(new Basket()).add("pear"));
  attempt(name + ": a basket's private name", () => copy(new Basket()).weight());
  attempt(name + ": a timer's arrow function", () => {
    const source = new Timer();
    const made = copy(source);
    return [made.tick(), made.tick(), made.ticks, source.ticks];
  });
  attempt(name + ": classes", () => [copy(new Point()) instanceof Point, copy(new Person()) instanceof Person, copy(new Basket()) instanceof Basket]);
  attempt(name + ": keys", () => [Object.keys(copy(new Point())), Object.keys(copy(new Person())), Object.keys(copy(new Basket()))]);
  attempt(name + ": an array", () => {
    const made = copy([1, 2, 3]);
    return [Array.isArray(made), made.length, made[1], typeof made.push];
  });
  attempt(name + ": a map", () => copy(new Map([["a", 1]])).get("a"));
}

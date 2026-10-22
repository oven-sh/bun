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

const log: string[] = [];

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}

class Point {
  static made = 0;
  static origin(): Point {
    return new this(0, 0);
  }
  constructor(public x: number, public y: number) {
    Point.made++;
  }
  sum(): number {
    return this.x + this.y;
  }
}

function watched(target: typeof Point): typeof Point {
  return new Proxy(target, {
    construct: (inner, list, newTarget) => (log.push("construct:" + list.join() + ":" + (newTarget === inner ? "target" : "other")), Reflect.construct(inner, list, newTarget)),
    get: (inner, key, receiver) => (log.push("get:" + String(key)), Reflect.get(inner, key, receiver)),
    apply: () => (log.push("apply"), undefined),
  });
}

function build(Class: typeof Point, x: number, y: number): Point {
  return new Class(x, y);
}

function sumOfBuilt(Class: typeof Point): number {
  return new Class(3, 4).sum();
}

function isOne(Class: typeof Point, value: object): boolean {
  return value instanceof Class;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += build(Point, i, 1).x + sumOfBuilt(Point) + (isOne(Point, new Point(1, 1)) ? 1 : 0);
console.log("after 2000 honest constructions", warm);

logged("constructed", () => build(watched(Point), 3, 4));
logged("constructed and used", () => sumOfBuilt(watched(Point)));
logged("what is made is an instance of the class", () => build(watched(Point), 3, 4) instanceof Point);
logged("instanceof the proxy", () => [isOne(watched(Point), new Point(1, 1)), isOne(watched(Point), {})]);
logged("a static method", () => watched(Point).origin().sum());
logged("a static field", () => typeof watched(Point).made);
logged("name, length, typeof", () => [watched(Point).name, watched(Point).length, typeof watched(Point)]);
logged("the prototype", () => watched(Point).prototype === Point.prototype);
logged("Reflect.construct", () => Reflect.construct(watched(Point), [3, 4]).sum());
logged("without traps", () => sumOfBuilt(new Proxy(Point, {})));
logged("a construct trap that makes a literal", () => {
  const Fake = new Proxy(Point, { construct: (_, list) => ({ x: list[0], y: list[1] }) });
  const made = build(Fake, 3, 4);
  return [made.x + made.y, made instanceof Point, typeof made.sum];
});
logged("a construct trap that makes a literal, used", () => sumOfBuilt(new Proxy(Point, { construct: (_, list) => ({ x: list[0], y: list[1] }) })));
logged("a construct trap that swaps the arguments", () => build(new Proxy(Point, { construct: (inner, list) => new inner(list[1], list[0]) }), 3, 4));
logged("a construct trap that answers a number", () => build(new Proxy(Point, { construct: () => Object(5).valueOf() }), 3, 4));
logged("a construct trap that throws", () => build(new Proxy(Point, { construct: () => { throw new RangeError("no"); } }), 3, 4));
logged("a subclass of the proxy", () => {
  class Child extends watched(Point) {
    z = 5;
  }
  const child = new Child(3, 4);
  return [child.sum(), child.z, child instanceof Point, Object.keys(child)];
});
logged("a revoked class", () => {
  const { proxy, revoke } = Proxy.revocable(Point, {});
  const before = sumOfBuilt(proxy);
  revoke();
  return [before, sumOfBuilt(proxy)];
});
logged("honest again", () => [build(Point, 3, 4), sumOfBuilt(Point)]);

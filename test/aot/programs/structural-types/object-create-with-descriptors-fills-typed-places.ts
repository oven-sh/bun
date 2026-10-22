class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  norm(): number {
    return Math.abs(this.x) + Math.abs(this.y);
  }
}

interface Pair {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

function sum(p: Pair): number {
  return p.x + p.y;
}

function norm(p: Point): number {
  return p.norm();
}

function move(p: Pair): Pair {
  p.x += 10;
  p.y += 10;
  return p;
}

const makers: [string, () => ReturnType<typeof Object.create>][] = [
  ["the prototype and nothing else", () => Object.create(Point.prototype)],
  ["data members", () => Object.create(Point.prototype, { x: { value: 1, writable: true, enumerable: true, configurable: true }, y: { value: 2, writable: true, enumerable: true, configurable: true } })],
  ["the other order", () => Object.create(Point.prototype, { y: { value: 2, writable: true, enumerable: true }, x: { value: 1, writable: true, enumerable: true } })],
  ["hidden members", () => Object.create(Point.prototype, { x: { value: 1, writable: true }, y: { value: 2, writable: true } })],
  ["members that cannot be written", () => Object.create(Point.prototype, { x: { value: 1, enumerable: true }, y: { value: 2, enumerable: true } })],
  ["texts", () => Object.create(Point.prototype, { x: { value: "1", writable: true, enumerable: true }, y: { value: "2", writable: true, enumerable: true } })],
  [
    "accessors",
    () => {
      let x = 1;
      return Object.create(Point.prototype, {
        x: {
          get() {
            log.push("get x");
            return x;
          },
          set(value) {
            log.push("set x");
            x = value;
          },
          enumerable: true,
        },
        y: { get: () => 2, enumerable: true },
      });
    },
  ],
  ["its own norm", () => Object.create(Point.prototype, { x: { value: 1 }, y: { value: 2 }, norm: { value: () => "own" } })],
  ["an instance as the prototype", () => Object.create(new Point(1, 2))],
  ["an instance as the prototype and one own member", () => Object.create(new Point(1, 2), { x: { value: 5, writable: true, enumerable: true } })],
  ["a frozen instance as the prototype", () => Object.create(Object.freeze(new Point(1, 2)))],
  ["a literal as the prototype", () => Object.create({ x: 1, y: 2, norm: () => 3 })],
  ["no prototype", () => Object.create(null, { x: { value: 1, writable: true, enumerable: true }, y: { value: 2, writable: true, enumerable: true } })],
  ["no prototype and nothing else", () => Object.create(null)],
  ["a list as the prototype", () => Object.create([1, 2])],
  ["a function as the prototype", () => Object.create(norm)],
  ["a proxy as the prototype", () => Object.create(new Proxy(new Point(1, 2), { get: (target, key, receiver) => (log.push("get " + String(key)), Reflect.get(target, key, receiver)) }))],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(new Point(i, 1)) + norm(new Point(i, 1)) + sum({ x: i, y: 1 }) + move({ x: i, y: 1 }).x;
console.log("2000 honest rounds: " + warm);

for (const [name, make] of makers) {
  attempt(name + ", read", () => {
    const p: Point = make();
    return [p.x, p.y, p.x + p.y, sum(p), p instanceof Point];
  });
  attempt(name + ", its method", () => {
    const p: Point = make();
    return [p.norm(), norm(p)];
  });
  attempt(name + ", its keys", () => {
    const p: Pair = make();
    const copy = { ...p };
    return [Object.keys(p).join(), JSON.stringify(p), Object.keys(copy).join(), "x" in p, Object.hasOwn(p, "x")];
  });
  attempt(name + ", stored to", () => {
    const p: Pair = make();
    p.x = 7;
    return [p.x, sum(p), Object.hasOwn(p, "x")];
  });
  attempt(name + ", updated", () => {
    const p: Pair = move(make());
    return [p.x, p.y, Object.keys(p).join()];
  });
  attempt(name + ", in a list and a field", () => {
    const list: Point[] = [new Point(1, 2), make()];
    const holder: { p: Pair } = { p: make() };
    return [list.map(sum), sum(holder.p)];
  });
}

export {};

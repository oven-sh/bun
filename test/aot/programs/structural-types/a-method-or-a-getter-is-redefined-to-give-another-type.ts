class Point {
  x = 3;
  norm(): number {
    return this.x * this.x;
  }
  get half(): number {
    return this.x / 2;
  }
  label(): string {
    return "point";
  }
  static zero(): number {
    return 0;
  }
}

function show(value: unknown): string {
  return typeof value + " " + (typeof value === "object" ? JSON.stringify(value) : typeof value === "bigint" ? value + "n" : String(value));
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function normPlusOne(p: Point): number {
  return p.norm() + 1;
}

function normTimesTwo(p: Point): number {
  return p.norm() * 2;
}

function normFixed(p: Point): string {
  return p.norm().toFixed(1);
}

function normInAList(p: Point): number[] {
  const list = [1.5];
  list.push(p.norm());
  return list;
}

function halfPlusOne(p: Point): number {
  return p.half + 1;
}

function halfAsInteger(p: Point): number {
  return p.half | 0;
}

function labelLength(p: Point): number {
  return p.label().length;
}

function zeroPlusOne(): number {
  return Point.zero() + 1;
}

function round(label: string): void {
  const p = new Point();
  attempt(label + ", the method plus one", () => normPlusOne(p));
  attempt(label + ", the method times two", () => normTimesTwo(p));
  attempt(label + ", toFixed of the method's result", () => normFixed(p));
  attempt(label + ", the method's result in a list of numbers", () => normInAList(p));
  attempt(label + ", the getter plus one", () => halfPlusOne(p));
  attempt(label + ", the getter as an integer", () => halfAsInteger(p));
  attempt(label + ", the length of the label", () => labelLength(p));
  attempt(label + ", the static method plus one", () => zeroPlusOne());
}

function give(value: unknown): void {
  Object.assign(Point.prototype, { norm: () => value, label: () => value });
  Object.defineProperty(Point.prototype, "half", { get: () => value, configurable: true });
  Object.assign(Point, { zero: () => value });
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += normPlusOne(new Point()) + normTimesTwo(new Point()) + halfPlusOne(new Point()) + labelLength(new Point()) + zeroPlusOne();
console.log("2000 honest: " + warm);
round("as written");

const written = { norm: Point.prototype.norm, label: Point.prototype.label, half: Object.getOwnPropertyDescriptor(Point.prototype, "half"), zero: Point.zero };

give("text");
round("a string");
give(undefined);
round("undefined");
give(null);
round("null");
give({ a: 1 });
round("an object");
give(7n);
round("a bigint");
give(true);
round("a boolean");
give([4]);
round("a list");

Object.assign(Point.prototype, { norm: 5, label: "not a function" });
Object.assign(Point, { zero: undefined });
round("members that cannot be called");

Point.prototype.norm = written.norm;
Point.prototype.label = written.label;
Point.zero = written.zero;
if (written.half) Object.defineProperty(Point.prototype, "half", written.half);
round("restored");

export {};

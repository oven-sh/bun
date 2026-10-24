function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

function area(width: number, height: number = width, unit?: string): string {
  return arguments.length + " given, " + text(width) + ", " + text(height) + ", " + text(unit) + " -> " + text(width * height) + (unit ?? "");
}

type AreaArguments = Parameters<typeof area>;
type AreaResult = ReturnType<typeof area>;

const recorded: AreaArguments[] = [];

function recording(...given: AreaArguments): AreaResult {
  recorded.push(given);
  return area(...given);
}

attempt("recording(2)", () => recording(2));
attempt("recording(2, 3)", () => recording(2, 3));
attempt("recording(2, undefined)", () => recording(2, undefined));
attempt("recording(2, undefined, 'm')", () => recording(2, undefined, "m"));
attempt("recorded", () => recorded.map(given => given.length + ":" + JSON.stringify(given)));
attempt("replayed", () => recorded.map(given => area(...given)));

for (const given of recorded) given.reverse();
attempt("replayed after each was reversed", () => recorded.map(given => area(...given)));
for (const given of recorded) given.splice(0);
attempt("replayed after each was emptied", () => recorded.map(given => area(...given)));

function wrap<A extends unknown[], R>(f: (...given: A) => R): (...given: A) => R {
  let calls = 0;
  return (...given: A): R => {
    calls++;
    given.push(calls);
    return f(...given);
  };
}

function two(a: number, b?: number, hidden?: string): string {
  return arguments.length + " given, " + [a, b, hidden].map(text).join(", ");
}
const shortTwo: (a: number, b?: number) => string = two;
attempt("a wrapper that pushes onto what it was given, two arguments", () => wrap(shortTwo)(1, 2));
attempt("one argument", () => wrap(shortTwo)(1));

function pick(key: "count"): number;
function pick(key: "name"): string;
function pick(key: string): number | string {
  return key === "count" ? 3 : "n";
}
type Picked = ReturnType<typeof pick>;
type Key = Parameters<typeof pick>[0];
const key: Key = "name";
const picked: Picked = pick(key);
attempt("the last overload decides both", () => [key, picked, picked.length]);
const wrappedPick = wrap(pick);
attempt("an overloaded function is wrapped", () => wrappedPick("name").length);

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number = x) {
    this.x = x;
    this.y = y;
  }
  plus(dx: number, dy: number = 0): Point {
    return new Point(this.x + dx, this.y + dy);
  }
}
type PointArguments = ConstructorParameters<typeof Point>;
type PlusArguments = Parameters<Point["plus"]>;
const forPoint: PointArguments[] = [[1], [1, 2], [1, undefined]];
attempt("constructor arguments", () => forPoint.map(given => new Point(...given)));
const forPlus: PlusArguments = [10];
attempt("method arguments", () => new Point(1).plus(...forPlus));
const made: InstanceType<typeof Point> = Reflect.construct(Point, forPoint[1]);
attempt("an instance type", () => [made, made instanceof Point]);

async function later(n: number): Promise<number> {
  return n + 1;
}
function* steps(n: number): Generator<number, string, void> {
  yield n;
  return "end";
}
const promise: ReturnType<typeof later> = later(1);
const settled: Awaited<ReturnType<typeof later>> = await promise;
const walker: ReturnType<typeof steps> = steps(5);
attempt("an async function's and a generator's results", () => [settled, walker.next(), walker.next()]);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += recording(i & 3, 2).length;
console.log("2000 recorded calls: " + warm + ", kept " + recorded.length);

export {};

interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).slice(0, 4).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function numberNamed(name: string): number {
  return globalThis[name];
}

function pointNamed(name: string): Point {
  return globalThis[name];
}

function functionNamed(name: string): (n: number) => number {
  return globalThis[name];
}

globalThis["sharedCount"] = 3;
globalThis["sharedPoint"] = { x: 1, y: 2 };
globalThis["sharedStep"] = n => n + 1;

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(numberNamed("sharedCount")) + sum(pointNamed("sharedPoint")) + functionNamed("sharedStep")(i);
console.log("2000 honest rounds: " + warm);

for (const name of ["sharedCount", "sharedPoint", "sharedStep", "sharedMissing", "NaN", "Infinity", "undefined", "Math", "parseInt", "Array", "globalThis"]) {
  attempt(name + " as a number", () => {
    const n = numberNamed(name);
    return [typeof n, n + 1 === n + 1, typeof plusOne(n)];
  });
  attempt(name + " as a point", () => {
    const p = pointNamed(name);
    return [typeof p, p.x, typeof sum(p)];
  });
  attempt(name + " as a function", () => {
    const f = functionNamed(name);
    return [typeof f, typeof f(1)];
  });
}

for (const value of ["3", null, [3], { x: "1", y: "2" }, true]) {
  globalThis["sharedCount"] = value;
  globalThis["sharedPoint"] = value;
  attempt("the shared count is " + show(value), () => [numberNamed("sharedCount") + 1, plusOne(numberNamed("sharedCount"))]);
  attempt("the shared point is " + show(value), () => [pointNamed("sharedPoint").x, sum(pointNamed("sharedPoint"))]);
}

attempt("deleted", () => {
  delete globalThis["sharedCount"];
  return [numberNamed("sharedCount"), "sharedCount" in globalThis];
});

const bag = { a: 1, b: "two" };
function memberNamed(name: string): number {
  return bag[name];
}
attempt("a literal read by a name of type string", () => [memberNamed("a") + 1, memberNamed("b") + 1, memberNamed("c") + 1, plusOne(memberNamed("b"))]);

function untyped(a, b) {
  return a + b;
}
attempt("parameters without a type", () => {
  const n: number = untyped("1", 2);
  const m: number = untyped(1, 2);
  return [n + 1, m + 1, plusOne(untyped([], {}))];
});

export {};

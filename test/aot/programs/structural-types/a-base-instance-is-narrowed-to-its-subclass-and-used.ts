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

class Shape {
  sides = 4;
  kind: "shape" | "square" = "shape";
  claimsSquare(): this is Square {
    return true;
  }
  assertSquare(): asserts this is Square {}
}

class Square extends Shape {
  edge = 2;
  label = "square";
  inner = { n: 1 };
  area(): number {
    return this.edge * this.edge;
  }
}

function isSquare(s: Shape): s is Square {
  return true;
}

function mustBeSquare(s: Shape): asserts s is Square {}

type Narrow = (s: Shape) => Square;

const byFunction: Narrow = s => {
  if (isSquare(s)) return s;
  throw new RangeError("never");
};
const byMethod: Narrow = s => {
  if (s.claimsSquare()) return s;
  throw new RangeError("never");
};
const byAssertion: Narrow = s => {
  mustBeSquare(s);
  return s;
};
const byAssertingMethod: Narrow = s => {
  const shape: Shape = s;
  shape.assertSquare();
  return shape;
};
const byFilter: Narrow = s => [s].filter(isSquare)[0];
const byFind: Narrow = s => {
  const found = [s].find(isSquare);
  if (found === undefined) throw new RangeError("never");
  return found;
};

const ways: [string, Narrow][] = [
  ["a function guard", byFunction],
  ["a method guard", byMethod],
  ["an assertion", byAssertion],
  ["an asserting method", byAssertingMethod],
  ["filter", byFilter],
  ["find", byFind],
];

function edgeTwice(q: Square): number {
  return q.edge * 2;
}

function labelSize(q: Square): number {
  return q.label.length;
}

function deep(q: Square): number {
  return q.inner.n;
}

function areaOf(q: Square): number {
  return q.area();
}

function grow(q: Square): number {
  q.edge += 1;
  return q.edge;
}

function put(q: Square): string {
  q.edge = 9;
  return Object.keys(q).join();
}

for (const [name, narrow] of ways) attempt("honest by " + name, () => [edgeTwice(narrow(new Square())), labelSize(narrow(new Square())), deep(narrow(new Square())), areaOf(narrow(new Square())), grow(narrow(new Square())), put(narrow(new Square()))]);
let warm = 0;
for (let i = 0; i < 2000; i++) for (const [, narrow] of ways) warm += edgeTwice(narrow(new Square())) + areaOf(narrow(new Square()));
console.log("2000 honest rounds", warm);

for (const [name, narrow] of ways) {
  attempt(name + ": a number field", () => edgeTwice(narrow(new Shape())));
  attempt(name + ": read in place", () => narrow(new Shape()).edge);
  attempt(name + ": a string field", () => labelSize(narrow(new Shape())));
  attempt(name + ": an object field", () => deep(narrow(new Shape())));
  attempt(name + ": a method", () => areaOf(narrow(new Shape())));
  attempt(name + ": updated", () => grow(narrow(new Shape())));
  attempt(name + ": stored", () => put(narrow(new Shape())));
  attempt(name + ": instanceof and keys", () => {
    const q = narrow(new Shape());
    return [q instanceof Square, Object.keys(q), "edge" in q, q.sides];
  });
}

attempt("in the same function as the test: a function guard", () => {
  const s = new Shape();
  return isSquare(s) ? s.edge * 2 : -1;
});
attempt("in the same function as the test: a method guard", () => {
  const s = new Shape();
  return s.claimsSquare() ? s.edge * 2 : -1;
});
attempt("in the same function as the test: an assertion", () => {
  const s = new Shape();
  mustBeSquare(s);
  return s.edge * 2;
});
attempt("in the same function as the test: an asserting method", () => {
  const s: Shape = new Shape();
  s.assertSquare();
  return s.edge * 2;
});
for (const [name, narrow] of ways) attempt("honest again by " + name, () => [edgeTwice(narrow(new Square())), areaOf(narrow(new Square()))]);

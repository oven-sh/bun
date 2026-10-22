function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Circle {
  kind: "circle" = "circle";
  radius = 1;
}

class Square {
  kind: "square" = "square";
  edge = 2;
}

type Shape = Circle | Square;
type Tagged = { kind: "circle" | "square" };
type Between = (t: Tagged) => void;

const keep: Between = () => {};
const toCircle: Between = t => {
  t.kind = "circle";
};
const toSquare: Between = t => {
  t.kind = "square";
};

function describe(s: Shape): string {
  switch (s.kind) {
    case "circle":
      return "circle " + s.radius;
    case "square":
      return "square " + s.edge;
  }
}

function betweenTestAndUse(s: Shape, between: Between): unknown {
  if (s.kind === "square") {
    between(s);
    return [s.kind, s.edge, describe(s), Object.keys(s).join(), s instanceof Square];
  }
  between(s);
  return [s.kind, s.radius, describe(s), Object.keys(s).join(), s instanceof Circle];
}

function testedTwice(s: Shape, between: Between): unknown {
  if (s.kind === "square") {
    between(s);
    if (s.kind === "square") return "still a square " + s.edge;
    return ["typed never", typeof s];
  }
  return "a circle " + s.radius;
}

attempt("honest square", () => betweenTestAndUse(new Square(), keep));
attempt("honest circle", () => betweenTestAndUse(new Circle(), keep));
for (let i = 0; i < 2000; i++) {
  betweenTestAndUse(i % 2 === 0 ? new Square() : new Circle(), keep);
  testedTwice(new Square(), keep);
}
attempt("a square is retagged", () => betweenTestAndUse(new Square(), toCircle));
attempt("a circle is retagged", () => betweenTestAndUse(new Circle(), toSquare));
attempt("a square is retagged and tested again", () => testedTwice(new Square(), toCircle));
attempt("retagged before the call", () => {
  const s = new Square();
  toCircle(s);
  return [describe(s), betweenTestAndUse(s, keep)];
});
attempt("retagged and back", () => {
  const s = new Square();
  toCircle(s);
  toSquare(s);
  return [describe(s), betweenTestAndUse(s, keep)];
});
attempt("in an array, sorted by tag", () => {
  const shapes: Shape[] = [new Square(), new Circle(), new Square()];
  toCircle(shapes[2]);
  toSquare(shapes[1]);
  return shapes.map(describe);
});
attempt("honest square again", () => betweenTestAndUse(new Square(), keep));

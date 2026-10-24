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

const log: string[] = [];

class Circle {
  readonly kind = "circle";
  radius = 1;
}

class Square {
  readonly kind = "square";
  edge = 2;
}

class Fickle {
  reads = 0;
  radius = 10;
  edge = 20;
  get kind(): "circle" | "square" {
    log.push("kind");
    return this.reads++ % 2 === 0 ? "circle" : "square";
  }
}

type Shape = Circle | Square;

function area(s: Shape): unknown {
  switch (s.kind) {
    case "circle":
      return ["circle", s.radius];
    case "square":
      return ["square", s.edge];
  }
}

function withIf(s: Shape): unknown {
  if (s.kind === "circle") return [s.kind, s.radius];
  return [s.kind, s.edge];
}

function twice(s: Shape): unknown {
  return s.kind === "circle" && s.kind === "circle" ? ["both", s.radius] : ["not both", s.kind];
}

attempt("honest", () => [area(new Circle()), area(new Square()), withIf(new Circle()), withIf(new Square())]);
for (let i = 0; i < 2000; i++) {
  area(i % 2 === 0 ? new Circle() : new Square());
  withIf(i % 2 === 0 ? new Circle() : new Square());
}
const fickle = new Fickle();
attempt("first switch", () => area(fickle));
attempt("second switch", () => area(fickle));
attempt("first if", () => withIf(fickle));
attempt("second if", () => withIf(fickle));
attempt("tested twice", () => twice(fickle));
attempt("tested twice again", () => twice(fickle));
console.log("reads of the tag: " + log.length);
attempt("honest again", () => [area(new Circle()), area(new Square())]);

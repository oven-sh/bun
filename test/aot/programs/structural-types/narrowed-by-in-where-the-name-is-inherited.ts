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
  radius = 1;
}

class Square {
  edge = 2;
}

class Ringed extends Circle {
  get edge(): string {
    return "computed";
  }
}

class Oval {
  radius = 3;
}

function edgeOrRadius(s: Circle | Square | Oval): unknown {
  if ("edge" in s) return ["edge", s.edge, s.edge * 2, s.edge + 1, Object.keys(s).join()];
  return ["radius", s.radius];
}

attempt("a circle", () => edgeOrRadius(new Circle()));
attempt("a square", () => edgeOrRadius(new Square()));
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const s: Circle | Square = i % 2 === 0 ? new Circle() : new Square();
  sum += "edge" in s ? s.edge : s.radius;
}
console.log("honest rounds: " + sum);

attempt("a getter on the prototype of a subclass", () => edgeOrRadius(new Ringed()));
attempt("the instance got a prototype with the name", () => {
  const c = new Circle();
  Object.setPrototypeOf(c, { edge: "from its new prototype" });
  return edgeOrRadius(c);
});
attempt("the name is undefined on the prototype", () => {
  const c = new Circle();
  Object.setPrototypeOf(c, { edge: undefined });
  return edgeOrRadius(c);
});
attempt("an oval before", () => edgeOrRadius(new Oval()));
Object.setPrototypeOf(Oval.prototype, { edge: "from the end of the chain" });
attempt("the prototype of the class got a parent with the name", () => edgeOrRadius(new Oval()));
attempt("a circle again", () => edgeOrRadius(new Circle()));
attempt("a square again", () => edgeOrRadius(new Square()));

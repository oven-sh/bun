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

class Square {
  edge = 2;
  corner = 90;
}

class Circle {
  radius = 1;
}

type Between = (s: { edge?: number }) => void;
const keep: Between = () => {};
const remove: Between = s => {
  delete s.edge;
};

function edgeOf(s: Square | Circle, between: Between): unknown {
  if ("edge" in s) {
    between(s);
    return [s.edge, s.edge * 2, s.corner, "edge" in s, Object.keys(s).join(), JSON.stringify(s)];
  }
  return ["radius", s.radius];
}

function literalEdgeOf(s: { edge: number; corner: number } | { radius: number }, between: Between): unknown {
  if ("edge" in s) {
    between(s);
    return [s.edge, s.edge * 2, s.corner, "edge" in s, Object.keys(s).join(), JSON.stringify(s)];
  }
  return ["radius", s.radius];
}

function which(s: Square | Circle): string {
  return "edge" in s ? "has an edge" : "typed as a circle, radius " + typeof s.radius;
}

attempt("honest class", () => edgeOf(new Square(), keep));
attempt("honest literal", () => literalEdgeOf({ edge: 2, corner: 90 }, keep));
for (let i = 0; i < 2000; i++) {
  edgeOf(new Square(), keep);
  literalEdgeOf({ edge: 2, corner: 90 }, keep);
}
attempt("deleted from a class instance", () => edgeOf(new Square(), remove));
attempt("deleted from a literal", () => literalEdgeOf({ edge: 2, corner: 90 }, remove));
attempt("deleted and stored again", () => {
  const s = new Square();
  remove(s);
  s.edge = 5;
  return [edgeOf(s, keep), Object.keys(s).join()];
});
attempt("deleted before the test", () => {
  const s = new Square();
  remove(s);
  return which(s);
});
attempt("honest class again", () => edgeOf(new Square(), keep));
attempt("honest literal again", () => literalEdgeOf({ edge: 2, corner: 90 }, keep));
